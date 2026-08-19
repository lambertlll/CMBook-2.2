//! 阿里云百炼 DashScope 实时语音识别（qwen3-asr-flash-realtime）
//!
//! 协议：Qwen-ASR-Realtime WebSocket（OpenAI-Realtime 兼容），全部为 JSON 文本帧。
//! 依据文档（各报文字段均以官方文档/SDK 源码为准，注释内注明出处）：
//! - 用户指南：https://help.aliyun.com/zh/model-studio/real-time-speech-recognition-user-guide
//! - 客户端事件：https://platform.qianwenai.com/docs/api-reference/speech-recognition/qwen-asr-realtime/client-events
//! - 服务端事件：https://platform.qianwenai.com/docs/api-reference/speech-recognition/qwen-asr-realtime/server-events
//! - 报文映射参考 dashscope Python SDK omni_realtime.py（corpus_text → corpus.text）
//!
//! 连接：wss://{workspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=qwen3-asr-flash-realtime
//! 鉴权：握手请求头 Authorization: Bearer <api-key>（文档"请求头"章节，另带 OpenAI-Beta: realtime=v1）。
//! 流程（VAD 模式，文档"交互流程"章节）：
//!   连接 → 收 session.created → 发 session.update（音频格式/语种/VAD/热词）
//!   → 收 session.updated → 持续发 input_audio_buffer.append（Base64 编码 PCM16 16kHz 单声道）
//!   → 发 session.finish → 收 session.finished → 关连接。
//! 结果事件：conversation.item.input_audio_transcription.text（interim：text 为已确认前缀、
//! stash 为可能修正的临时后缀，UI 显示 text+stash）；
//! conversation.item.input_audio_transcription.completed（final：transcript 整句定稿）。
//! 注意：该模型不返回时间戳（文档"获取时间戳"章节明确说明）；emotion 固定返回，无需配置。
//!
//! session 式设计：connect 返回 session_id，send_pcm / finish / disconnect 按 session 操作，
//! 结果通过 app.emit 推送前端：`dashscope-asr-result` / `dashscope-asr-error`。

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{mpsc, watch, Mutex};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, http::HeaderValue, Message},
};

/// 模型名（固定，文档"连接端点"章节通过 model 查询参数指定）
const MODEL: &str = "qwen3-asr-flash-realtime";
/// 连接握手与 session.created/session.updated 确认的超时
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
/// WS 心跳间隔：长时会议（30 分钟+）下保持连接活跃，避免被服务端/中间层 RST
const WS_PING_INTERVAL: Duration = Duration::from_secs(30);
/// finish 等待 session.finished 的超时（服务端收尾一般较快，留足余量）
const FINISH_TIMEOUT: Duration = Duration::from_secs(60);

/// 全局 session 表（不跨 I/O 持锁：取出 sender/信号后即释放锁）
/// 供新旧两套实时协议（realtime / inference）共用
#[derive(Default)]
pub struct DashscopeAsrManager {
    sessions: Mutex<HashMap<String, DashscopeAsrSession>>,
}

impl DashscopeAsrManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    /// 取出 session 的发送通道与结束信号（不持锁返回，避免跨 I/O 持锁）
    pub async fn get_session(
        &self,
        session_id: &str,
    ) -> Option<(mpsc::UnboundedSender<Message>, watch::Receiver<bool>)> {
        let sessions = self.sessions.lock().await;
        sessions.get(session_id).map(|s| (s.tx.clone(), s.done.clone()))
    }

    /// 注册会话
    pub async fn insert_session(
        &self,
        session_id: String,
        tx: mpsc::UnboundedSender<Message>,
        done: watch::Receiver<bool>,
    ) {
        self.sessions
            .lock()
            .await
            .insert(session_id, DashscopeAsrSession { tx, done });
    }

    /// 移除会话（连接随 writer 任务退出而关闭）
    pub async fn remove_session(&self, session_id: &str) {
        self.sessions.lock().await.remove(session_id);
    }
}

struct DashscopeAsrSession {
    /// 写通道：音频帧/控制帧经此发往 writer 任务，发送方无需持锁做 I/O
    tx: mpsc::UnboundedSender<Message>,
    /// 结束信号：reader 任务收到 session.finished 或连接关闭时置位
    done: watch::Receiver<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashscopeAsrConnectConfig {
    pub api_key: String,
    /// 百炼业务空间 ID（华北2-北京域名，与同步 qwen3 通道一致）
    pub workspace_id: String,
    /// 语种（文档"支持的语言"章节，如 zh / yue / en）
    pub language: String,
    /// 热词/上下文偏置文本（session.input_audio_transcription.corpus.text，上限 10000 token）
    pub corpus_text: Option<String>,
    /// ASR 模型名（qwen3-asr-flash-realtime / qwen-audio-3.0-asr-flash-streaming 等）；
    /// 为空时回退默认 MODEL
    pub model: Option<String>,
}

/// 推送前端的识别结果事件
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DashscopeAsrResultEvent {
    session_id: String,
    /// 'interim'（text+stash 滚动更新）| 'final'（整句定稿）
    #[serde(rename = "type")]
    result_type: String,
    /// 关联的对话项 ID（文档 item_id 字段；同一 item 的 interim 反复覆盖）
    item_id: String,
    text: String,
    /// 情绪标签（该模型固定返回：surprised/neutral/happy/sad/disgusted/angry/fearful）
    emotion: String,
    /// 检测到的语种
    language: String,
}

/// 推送前端的错误事件
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DashscopeAsrErrorEvent {
    session_id: String,
    /// 关联的对话项 ID（error 事件可能为空）
    item_id: String,
    code: String,
    message: String,
}

/// 事件 ID（文档要求唯一 event_id，格式参照 SDK：event_ + uuid hex）
fn new_event_id() -> String {
    format!("event_{}", uuid::Uuid::new_v4().simple())
}

/// 构造 session.update 报文（文档"客户端事件 > session.update"章节）
/// - input_audio_format/sample_rate：PCM16 16kHz 单声道裸流
/// - input_audio_transcription.language：识别语种
/// - input_audio_transcription.corpus.text：热词/上下文偏置（SDK 中 corpus_text 映射为 corpus.text）
/// - turn_detection：服务端 VAD 自动断句；threshold 0.2 / silence_duration_ms 800 为文档
///   "均衡（默认）"预设，适合会议转写（低延迟预设 0.0/400 面向快速交互场景）
fn build_session_update(config: &DashscopeAsrConnectConfig) -> Value {
    let mut transcription = json!({ "language": config.language });
    if let Some(corpus_text) = config.corpus_text.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        transcription["corpus"] = json!({ "text": corpus_text });
    }
    json!({
        "event_id": new_event_id(),
        "type": "session.update",
        "session": {
            "modalities": ["text"],
            "input_audio_format": "pcm",
            "sample_rate": 16000,
            "input_audio_transcription": transcription,
            "turn_detection": {
                "type": "server_vad",
                "threshold": 0.2,
                "silence_duration_ms": 800,
            },
        },
    })
}

/// 构造 input_audio_buffer.append 报文（音频为 Base64 编码，文档"客户端事件"章节）
fn build_audio_append(pcm_bytes: &[u8]) -> Value {
    json!({
        "event_id": new_event_id(),
        "type": "input_audio_buffer.append",
        "audio": BASE64.encode(pcm_bytes),
    })
}

/// 构造 session.finish 报文（结束会话；服务端收齐识别后回 session.finished）
fn build_session_finish() -> Value {
    json!({
        "event_id": new_event_id(),
        "type": "session.finish",
    })
}

/// 服务端下行事件解析结果
enum ServerEvent {
    /// 连接建立后的第一个事件
    SessionCreated,
    /// session.update 处理完成
    SessionUpdated,
    /// 实时识别中间结果（text：已确认前缀；stash：临时后缀，UI 显示 text+stash）
    Interim {
        item_id: String,
        text: String,
        stash: String,
        emotion: String,
        language: String,
    },
    /// 整句最终识别结果（transcript）
    Final {
        item_id: String,
        transcript: String,
        emotion: String,
        language: String,
    },
    /// 单个对话项识别失败（conversation.item.input_audio_transcription.failed）
    ItemFailed {
        item_id: String,
        code: String,
        message: String,
    },
    /// 会话级错误（error 事件）
    Error { code: String, message: String },
    /// 所有识别完成（对 session.finish 的应答）
    SessionFinished,
    /// 其他事件（speech_started/speech_stopped/committed/item.created 等，无需处理）
    Ignore,
}

fn as_str(value: Option<&Value>) -> String {
    value
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string()
}

/// 解析服务端 JSON 文本帧（事件名与字段名均按文档"服务端事件"章节）
fn parse_server_event(text: &str) -> ServerEvent {
    let Ok(value) = serde_json::from_str::<Value>(text) else {
        return ServerEvent::Ignore;
    };
    match value.get("type").and_then(|t| t.as_str()).unwrap_or_default() {
        "session.created" => ServerEvent::SessionCreated,
        "session.updated" => ServerEvent::SessionUpdated,
        "conversation.item.input_audio_transcription.text" => ServerEvent::Interim {
            item_id: as_str(value.get("item_id")),
            text: as_str(value.get("text")),
            stash: as_str(value.get("stash")),
            emotion: as_str(value.get("emotion")),
            language: as_str(value.get("language")),
        },
        "conversation.item.input_audio_transcription.completed" => ServerEvent::Final {
            item_id: as_str(value.get("item_id")),
            transcript: as_str(value.get("transcript")),
            emotion: as_str(value.get("emotion")),
            language: as_str(value.get("language")),
        },
        "conversation.item.input_audio_transcription.failed" => {
            let error = value.get("error").cloned().unwrap_or(Value::Null);
            ServerEvent::ItemFailed {
                item_id: as_str(value.get("item_id")),
                code: as_str(error.get("code")),
                message: as_str(error.get("message")),
            }
        }
        "session.finished" => ServerEvent::SessionFinished,
        "error" => {
            let error = value.get("error").cloned().unwrap_or(Value::Null);
            ServerEvent::Error {
                code: as_str(error.get("code")),
                message: as_str(error.get("message")),
            }
        }
        _ => ServerEvent::Ignore,
    }
}

/// 建立 ASR 会话：建连（鉴权头）→ 等 session.created → 发 session.update → 等 session.updated。
/// 成功后返回 session_id，结果事件经 app.emit 推送。
#[tauri::command]
pub async fn dashscope_asr_connect(
    app: AppHandle,
    manager: State<'_, DashscopeAsrManager>,
    config: DashscopeAsrConnectConfig,
) -> Result<String, String> {
    // 华北2（北京）地域的业务空间域名（与同步 qwen3 通道同一套域名规则）；
    // model 通过查询参数指定（文档"连接端点"章节）；支持从配置传入以切换新一代模型
    let model = config.model.as_deref().unwrap_or(MODEL);
    let url = format!(
        "wss://{}.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model={}",
        config.workspace_id, model
    );

    // 先用 URL 生成标准握手请求（自动带 Host/Upgrade/Sec-WebSocket-Key 等），再追加鉴权头
    let mut request = url
        .as_str()
        .into_client_request()
        .map_err(|e| format!("无效的连接地址 `{url}`: {e}"))?;
    {
        let headers = request.headers_mut();
        // 文档"请求头"章节：Authorization: Bearer $DASHSCOPE_API_KEY
        let auth = HeaderValue::from_str(&format!("Bearer {}", config.api_key))
            .map_err(|e| format!("API Key 含非法字符: {e}"))?;
        headers.insert("Authorization", auth);
        // 文档"客户端事件"章节示例携带 OpenAI-Beta: realtime=v1
        headers.insert("OpenAI-Beta", HeaderValue::from_static("realtime=v1"));
    }

    let (ws, _) = tokio::time::timeout(CONNECT_TIMEOUT, connect_async(request))
        .await
        .map_err(|_| "连接 DashScope 实时识别超时".to_string())?
        .map_err(|e| format!("连接 DashScope 实时识别失败: {e}"))?;

    let (mut sink, stream) = ws.split();

    // 等待 session.created（连接建立后的第一个事件），期间可能直接返回 error
    let stream = wait_for_event(stream, |e| matches!(e, ServerEvent::SessionCreated))
        .await
        .map_err(|e| format!("等待 session.created 失败: {e}"))?;

    sink.send(Message::Text(build_session_update(&config).to_string().into()))
        .await
        .map_err(|e| format!("发送 session.update 失败: {e}"))?;

    // 等待 session.updated（失败时服务端回 error 事件）
    let stream = wait_for_event(stream, |e| matches!(e, ServerEvent::SessionUpdated))
        .await
        .map_err(|e| format!("等待 session.updated 失败: {e}"))?;

    let session_id = uuid::Uuid::new_v4().to_string();
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();
    let (done_tx, done_rx) = watch::channel(false);

    // writer 任务：独占 sink，转发写通道消息；每 30s 发送一次 Ping 保活
    // （长时会议录音下连接持续 30 分钟以上，无心跳会被服务端/中间层判定
    //   非活跃而 RST 断开——用户实测 19/35 分钟均出现 IO error 断连）
    tokio::spawn(async move {
        let mut ping_interval = tokio::time::interval(WS_PING_INTERVAL);
        loop {
            tokio::select! {
                msg = rx.recv() => {
                    match msg {
                        Some(msg) => {
                            if sink.send(msg).await.is_err() {
                                break;
                            }
                        }
                        None => break, // 通道关闭（会话结束）
                    }
                }
                _ = ping_interval.tick() => {
                    // 忽略首次立即 tick（interval 首拍立即触发），后续每 30s 一次
                    if sink.send(Message::Ping(vec![])).await.is_err() {
                        break;
                    }
                }
            }
        }
        let _ = sink.close().await;
    });

    // reader 任务：解析下行事件并 emit 给前端，连接结束时置位 done
    {
        let session_id = session_id.clone();
        let app = app.clone();
        tokio::spawn(async move {
            let mut stream = stream;
            while let Some(msg) = stream.next().await {
                match msg {
                    Ok(Message::Text(text)) => match parse_server_event(&text) {
                        ServerEvent::Interim {
                            item_id,
                            text,
                            stash,
                            emotion,
                            language,
                        } => {
                            // interim 展示文本 = 已确认前缀 + 临时后缀（文档示例 UI 显示 text+stash）
                            let _ = app.emit(
                                "dashscope-asr-result",
                                DashscopeAsrResultEvent {
                                    session_id: session_id.clone(),
                                    result_type: "interim".to_string(),
                                    item_id,
                                    text: format!("{text}{stash}"),
                                    emotion,
                                    language,
                                },
                            );
                        }
                        ServerEvent::Final {
                            item_id,
                            transcript,
                            emotion,
                            language,
                        } => {
                            let _ = app.emit(
                                "dashscope-asr-result",
                                DashscopeAsrResultEvent {
                                    session_id: session_id.clone(),
                                    result_type: "final".to_string(),
                                    item_id,
                                    text: transcript,
                                    emotion,
                                    language,
                                },
                            );
                        }
                        ServerEvent::ItemFailed {
                            item_id,
                            code,
                            message,
                        } => {
                            let _ = app.emit(
                                "dashscope-asr-error",
                                DashscopeAsrErrorEvent {
                                    session_id: session_id.clone(),
                                    item_id,
                                    code,
                                    message,
                                },
                            );
                        }
                        ServerEvent::Error { code, message } => {
                            let _ = app.emit(
                                "dashscope-asr-error",
                                DashscopeAsrErrorEvent {
                                    session_id: session_id.clone(),
                                    item_id: String::new(),
                                    code,
                                    message,
                                },
                            );
                        }
                        ServerEvent::SessionFinished => {
                            let _ = done_tx.send(true);
                        }
                        _ => {}
                    },
                    Ok(Message::Close(_)) => {
                        // 服务端主动关闭连接：emit error 通知前端，避免前端不知情持续发送
                        let _ = app.emit(
                            "dashscope-asr-error",
                            DashscopeAsrErrorEvent {
                                session_id: session_id.clone(),
                                item_id: String::new(),
                                code: "CLOSED".to_string(),
                                message: "DashScope 连接已被服务端关闭".to_string(),
                            },
                        );
                        break;
                    }
                    Err(e) => {
                        let _ = app.emit(
                            "dashscope-asr-error",
                            DashscopeAsrErrorEvent {
                                session_id: session_id.clone(),
                                item_id: String::new(),
                                code: "WS".to_string(),
                                message: format!("DashScope 连接异常: {e}"),
                            },
                        );
                        break;
                    }
                    _ => {}
                }
            }
            let _ = done_tx.send(true);
        });
    }

    manager
        .insert_session(session_id.clone(), tx, done_rx)
        .await;
    Ok(session_id)
}

/// 等待阶段从流中取出满足条件的事件；遇到 error 事件/连接关闭/超时则报错，成功返回剩余流
async fn wait_for_event<S>(mut stream: S, want: impl Fn(&ServerEvent) -> bool) -> Result<S, String>
where
    S: StreamExt<Item = Result<Message, tokio_tungstenite::tungstenite::Error>> + Unpin,
{
    tokio::time::timeout(CONNECT_TIMEOUT, async {
        while let Some(msg) = stream.next().await {
            match msg {
                Ok(Message::Text(text)) => match parse_server_event(&text) {
                    event if want(&event) => return Ok(stream),
                    ServerEvent::Error { code, message } => {
                        return Err(format!("服务端返回错误: {code} {message}"))
                    }
                    _ => {}
                },
                Ok(Message::Close(_)) => return Err("服务端在启动阶段关闭了连接".to_string()),
                Err(e) => return Err(format!("连接异常: {e}")),
                _ => {}
            }
        }
        Err("连接在启动阶段断开".to_string())
    })
    .await
    .map_err(|_| "等待服务端确认超时".to_string())?
}

/// 发送一帧 PCM 数据（16kHz 16bit 单声道；前端按 ~100ms 实时速率发送，本命令不睡眠）
#[tauri::command]
pub async fn dashscope_asr_send_pcm(
    manager: State<'_, DashscopeAsrManager>,
    session_id: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    let (tx, done) = manager
        .get_session(&session_id)
        .await
        .ok_or_else(|| "DashScope ASR session 不存在或已关闭".to_string())?;
    // 连接已断（reader 收到 Close/error 退出后 done=true）：立即拒绝，
    // 避免 PCM 数据进入无界 channel 积压导致内存增长
    if *done.borrow() {
        return Err("DashScope 连接已断开，发送失败".to_string());
    }
    tx.send(Message::Text(build_audio_append(&bytes).to_string().into()))
        .map_err(|_| "DashScope 连接已断开，发送失败".to_string())
}

/// 结束转写：发 session.finish，等待 session.finished 后关闭并清理 session
#[tauri::command]
pub async fn dashscope_asr_finish(
    manager: State<'_, DashscopeAsrManager>,
    session_id: String,
) -> Result<(), String> {
    let (tx, mut done) = manager
        .get_session(&session_id)
        .await
        .ok_or_else(|| "DashScope ASR session 不存在或已关闭".to_string())?;
    tx.send(Message::Text(build_session_finish().to_string().into()))
        .map_err(|_| "DashScope 连接已断开，无法发送 session.finish".to_string())?;

    // tx 保持存活直到等待结束，避免 writer 提前关闭连接
    let result = tokio::time::timeout(FINISH_TIMEOUT, done.wait_for(|v| *v))
        .await
        .map_err(|_| "等待 session.finished 超时".to_string())
        .and_then(|r| r.map(|_| ()).map_err(|_| "DashScope 连接异常结束".to_string()));
    drop(tx);

    // 无论成功与否都清理 session（tx 全部释放后 writer 任务会关闭连接）
    manager.remove_session(&session_id).await;
    result
}

/// 异常清理：直接移除 session，连接随 writer 任务退出而关闭
#[tauri::command]
pub async fn dashscope_asr_disconnect(
    manager: State<'_, DashscopeAsrManager>,
    session_id: String,
) -> Result<(), String> {
    manager.remove_session(&session_id).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config(corpus: Option<&str>) -> DashscopeAsrConnectConfig {
        DashscopeAsrConnectConfig {
            api_key: "sk-test".to_string(),
            workspace_id: "ws-test".to_string(),
            language: "zh".to_string(),
            corpus_text: corpus.map(|s| s.to_string()),
            model: None,
        }
    }

    #[test]
    fn session_update_shape() {
        let value = build_session_update(&test_config(Some("招商银行、客户经理")));
        assert_eq!(value["type"], "session.update");
        assert!(value["event_id"].as_str().unwrap().starts_with("event_"));
        let session = &value["session"];
        assert_eq!(session["modalities"], json!(["text"]));
        assert_eq!(session["input_audio_format"], "pcm");
        assert_eq!(session["sample_rate"], 16000);
        assert_eq!(session["input_audio_transcription"]["language"], "zh");
        assert_eq!(
            session["input_audio_transcription"]["corpus"]["text"],
            "招商银行、客户经理"
        );
        assert_eq!(session["turn_detection"]["type"], "server_vad");
        assert_eq!(session["turn_detection"]["threshold"], 0.2);
        assert_eq!(session["turn_detection"]["silence_duration_ms"], 800);
    }

    #[test]
    fn session_update_without_corpus() {
        for corpus in [None, Some(""), Some("  ")] {
            let value = build_session_update(&test_config(corpus));
            assert!(value["session"]["input_audio_transcription"].get("corpus").is_none());
        }
    }

    #[test]
    fn audio_append_base64() {
        let value = build_audio_append(&[0x01, 0x02, 0x03]);
        assert_eq!(value["type"], "input_audio_buffer.append");
        // [1,2,3] 的标准 Base64 编码
        assert_eq!(value["audio"], "AQID");
    }

    #[test]
    fn session_finish_shape() {
        let value = build_session_finish();
        assert_eq!(value["type"], "session.finish");
        assert!(value["event_id"].as_str().unwrap().starts_with("event_"));
    }

    #[test]
    fn parse_interim_text_event() {
        // 文档"服务端事件"章节示例
        let text = r#"{"event_id":"event_R7Pfu8QVBfP5HmpcbEFSd","type":"conversation.item.input_audio_transcription.text","item_id":"item_MpJQPNQzqVRc9aC9zMwSj","content_index":0,"language":"en","emotion":"neutral","text":"","stash":"Beijing's"}"#;
        match parse_server_event(text) {
            ServerEvent::Interim {
                item_id,
                text,
                stash,
                emotion,
                language,
            } => {
                assert_eq!(item_id, "item_MpJQPNQzqVRc9aC9zMwSj");
                assert_eq!(text, "");
                assert_eq!(stash, "Beijing's");
                assert_eq!(emotion, "neutral");
                assert_eq!(language, "en");
            }
            _ => panic!("应解析为 Interim"),
        }
    }

    #[test]
    fn parse_completed_event() {
        let text = r#"{"event_id":"event_B3GGEjPT2sLzjBM74W6kB","type":"conversation.item.input_audio_transcription.completed","item_id":"item_B3GGC53jGOuIFcjZkmEQ9","content_index":0,"language":"en","emotion":"neutral","transcript":"What's the weather like today?"}"#;
        match parse_server_event(text) {
            ServerEvent::Final {
                item_id,
                transcript,
                ..
            } => {
                assert_eq!(item_id, "item_B3GGC53jGOuIFcjZkmEQ9");
                assert_eq!(transcript, "What's the weather like today?");
            }
            _ => panic!("应解析为 Final"),
        }
    }

    #[test]
    fn parse_item_failed_event() {
        let text = r#"{"event_id":"event_B4KHRpC2nXs7dLmqTVo1f","type":"conversation.item.input_audio_transcription.failed","item_id":"item_B4KHRmVbcQwp9yZk2UeN3","content_index":0,"error":{"code":"audio_unintelligible","message":"The audio could not be transcribed.","param":null}}"#;
        match parse_server_event(text) {
            ServerEvent::ItemFailed {
                item_id,
                code,
                message,
            } => {
                assert_eq!(item_id, "item_B4KHRmVbcQwp9yZk2UeN3");
                assert_eq!(code, "audio_unintelligible");
                assert_eq!(message, "The audio could not be transcribed.");
            }
            _ => panic!("应解析为 ItemFailed"),
        }
    }

    #[test]
    fn parse_error_event() {
        let text = r#"{"event_id":"event_B2uoU7VOt1AAITsPRPH9n","type":"error","error":{"type":"invalid_request_error","code":"invalid_value","message":"Invalid value: 'pcm16'. Supported values are: 'pcm', 'opus'.","param":"session.input_audio_format","event_id":"event_123"}}"#;
        match parse_server_event(text) {
            ServerEvent::Error { code, message } => {
                assert_eq!(code, "invalid_value");
                assert!(message.contains("pcm16"));
            }
            _ => panic!("应解析为 Error"),
        }
    }

    #[test]
    fn parse_session_events() {
        assert!(matches!(
            parse_server_event(r#"{"type":"session.created","session":{"id":"sess_001"}}"#),
            ServerEvent::SessionCreated
        ));
        assert!(matches!(
            parse_server_event(r#"{"type":"session.updated","session":{"id":"sess_001"}}"#),
            ServerEvent::SessionUpdated
        ));
        assert!(matches!(
            parse_server_event(r#"{"event_id":"event_2239","type":"session.finished"}"#),
            ServerEvent::SessionFinished
        ));
    }

    #[test]
    fn parse_vad_events_ignored() {
        for text in [
            r#"{"type":"input_audio_buffer.speech_started","audio_start_ms":64,"item_id":"item_1"}"#,
            r#"{"type":"input_audio_buffer.speech_stopped","audio_end_ms":28128,"item_id":"item_1"}"#,
            r#"{"type":"input_audio_buffer.committed","item_id":"msg_002"}"#,
            r#"{"type":"conversation.item.created","item":{"id":"item_1"}}"#,
        ] {
            assert!(matches!(parse_server_event(text), ServerEvent::Ignore));
        }
    }

    #[test]
    fn parse_garbage_is_ignored() {
        assert!(matches!(parse_server_event("not json"), ServerEvent::Ignore));
        assert!(matches!(parse_server_event(r#"{"foo":1}"#), ServerEvent::Ignore));
    }
}
