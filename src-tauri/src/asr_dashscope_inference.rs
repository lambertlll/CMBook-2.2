//! 阿里云百炼 DashScope 实时语音识别（Qwen-Audio-3.0-ASR-Flash-Streaming / Fun-ASR-Realtime）
//! 「流式任务」协议通道：与旧版 realtime 通道（session.update 协议）完全不同——
//! - 端点：wss://{workspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference
//! - 客户端指令：run-task（JSON 文本帧）→ 等 task-started → 二进制音频帧（PCM 16kHz 单声道）
//!   → finish-task → 等 task-finished
//! - 服务端事件：result-generated（sentence_end=false 中间 / true 最终）
//! 会话管理与事件推送复用 asr_dashscope_realtime 的 DashscopeAsrManager，
//! 结果事件仍推送 dashscope-asr-result / dashscope-asr-error，前端无需区分通道。
//! 文档：https://help.aliyun.com/zh/model-studio/fun-asr-realtime-websocket-api

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{mpsc, watch};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, tungstenite::client::IntoClientRequest};

use crate::asr_dashscope_realtime::DashscopeAsrManager;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const FINISH_TIMEOUT: Duration = Duration::from_secs(60);

/// 会话建立配置（与 realtime 通道同字段，前端复用同一 buildConfig）
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashscopeInferenceConnectConfig {
    pub api_key: String,
    pub workspace_id: String,
    /// 语种（当前固定 zh；文档语言参数由 language_hints 控制，这里保留字段兼容前端）
    pub language: String,
    /// 热词/上下文偏置文本（转为即时热词 vocabulary 的字段说明，暂用于 context 注入）
    pub corpus_text: Option<String>,
    /// 模型名（qwen-audio-3.0-asr-flash-streaming / fun-asr-realtime）
    pub model: Option<String>,
}

/// 推送前端的识别结果事件（与 realtime 通道共用，前端事件消费不变）
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct InferenceResultEvent {
    session_id: String,
    /// 'interim'（sentence_end=false）| 'final'（sentence_end=true）
    #[serde(rename = "type")]
    result_type: String,
    /// 关联句 ID（sentence_id，转字符串以对齐 realtime 的 item_id 字段）
    item_id: String,
    text: String,
    emotion: String,
    language: String,
}

/// 推送前端的错误事件
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct InferenceErrorEvent {
    session_id: String,
    item_id: String,
    code: String,
    message: String,
}

/// 构造 run-task 指令（流式任务协议）
fn build_run_task(model: &str, config: &DashscopeInferenceConnectConfig) -> Value {
    let mut parameters = json!({
        "format": "pcm",
        "sample_rate": 16000,
    });
    // 即时热词：corpus_text 拆词注入 vocabulary（仅新模型支持）
    if let Some(corpus) = config.corpus_text.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        let words = corpus
            .split(|c: char| c == '、' || c == ',' || c == '，' || c == ' ')
            .filter(|w| !w.is_empty())
            .collect::<Vec<_>>();
        if !words.is_empty() {
            let mut vocabulary = serde_json::Map::new();
            for w in words {
                vocabulary.insert(w.to_string(), json!(5));
            }
            parameters["vocabulary"] = Value::Object(vocabulary);
        }
    }

    json!({
        "header": {
            "action": "run-task",
            "task_id": uuid::Uuid::new_v4().to_string(),
            "streaming": "duplex",
        },
        "payload": {
            "task_group": "audio",
            "task": "asr",
            "function": "recognition",
            "model": model,
            "parameters": parameters,
            "input": {},
        },
    })
}

/// 构造 finish-task 指令
fn build_finish_task() -> Value {
    json!({
        "header": {
            "action": "finish-task",
            "task_id": uuid::Uuid::new_v4().to_string(),
            "streaming": "duplex",
        },
        "payload": { "input": {} },
    })
}

/// 服务端下行事件解析结果
enum InferenceServerEvent {
    /// 任务启动成功（可发送音频）
    TaskStarted,
    /// 识别结果（sentence_end=false 中间 / true 最终）
    Result { sentence_end: bool, sentence_id: i64, text: String, begin_time: i64, end_time: i64 },
    /// 任务正常结束
    TaskFinished,
    /// 任务失败（连接将关闭）
    TaskFailed { code: String, message: String },
    /// 其他事件
    Ignore,
}

fn as_str(value: Option<&Value>) -> String {
    value.and_then(|v| v.as_str()).unwrap_or_default().to_string()
}

fn as_i64(value: Option<&Value>) -> i64 {
    value.and_then(|v| v.as_i64()).unwrap_or(0)
}

/// 解析服务端 JSON 文本帧（header.event 区分事件类型）
fn parse_inference_event(text: &str) -> InferenceServerEvent {
    let Ok(value) = serde_json::from_str::<Value>(text) else {
        return InferenceServerEvent::Ignore;
    };
    let header = value.get("header").cloned().unwrap_or(Value::Null);
    let event = as_str(header.get("event"));
    match event.as_str() {
        "task-started" => InferenceServerEvent::TaskStarted,
        "result-generated" => {
            let sentence = value
                .get("payload")
                .and_then(|p| p.get("output"))
                .and_then(|o| o.get("sentence"))
                .cloned()
                .unwrap_or(Value::Null);
            InferenceServerEvent::Result {
                sentence_end: sentence.get("sentence_end").and_then(|v| v.as_bool()).unwrap_or(false),
                sentence_id: as_i64(sentence.get("sentence_id")),
                text: as_str(sentence.get("text")),
                begin_time: as_i64(sentence.get("begin_time")),
                end_time: as_i64(sentence.get("end_time")),
            }
        }
        "task-finished" => InferenceServerEvent::TaskFinished,
        "task-failed" => InferenceServerEvent::TaskFailed {
            code: as_str(header.get("error_code")),
            message: as_str(header.get("error_message")),
        },
        _ => InferenceServerEvent::Ignore,
    }
}

/// 建立实时识别会话：连接 /api-ws/v1/inference → 发 run-task → 等 task-started。
/// 成功后返回 session_id，结果事件经 app.emit 推送。
#[tauri::command]
pub async fn dashscope_inference_connect(
    app: AppHandle,
    manager: State<'_, DashscopeAsrManager>,
    config: DashscopeInferenceConnectConfig,
) -> Result<String, String> {
    let model = config
        .model
        .as_deref()
        .filter(|m| !m.is_empty())
        .unwrap_or("qwen-audio-3.0-asr-flash-streaming");
    // 流式任务协议使用 /api-ws/v1/inference 端点（与 realtime 的 /api-ws/v1/realtime 不同）
    let url = format!(
        "wss://{}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference",
        config.workspace_id
    );

    let mut request = url
        .as_str()
        .into_client_request()
        .map_err(|e| format!("无效的连接地址 `{url}`: {e}"))?;
    {
        let headers = request.headers_mut();
        let auth = format!("Bearer {}", config.api_key);
        headers.insert(
            "Authorization",
            tauri::http::HeaderValue::from_str(&auth)
                .map_err(|e| format!("API Key 含非法字符: {e}"))?,
        );
        headers.insert("user-agent", tauri::http::HeaderValue::from_static("cmbook/2.8"));
    }

    let (ws, _) = tokio::time::timeout(CONNECT_TIMEOUT, connect_async(request))
        .await
        .map_err(|_| "连接 DashScope 实时识别超时".to_string())?
        .map_err(|e| format!("连接 DashScope 实时识别失败: {e}"))?;

    let (mut sink, mut stream) = ws.split();

    // 发 run-task 并等待 task-started
    sink.send(Message::Text(build_run_task(model, &config).to_string().into()))
        .await
        .map_err(|e| format!("发送 run-task 失败: {e}"))?;

    let task_started = tokio::time::timeout(CONNECT_TIMEOUT, async {
        while let Some(msg) = stream.next().await {
            match msg {
                Ok(Message::Text(text)) => match parse_inference_event(&text) {
                    InferenceServerEvent::TaskStarted => return Ok(()),
                    InferenceServerEvent::TaskFailed { code, message } => {
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
    .map_err(|_| "等待服务端确认超时".to_string())??;

    let session_id = uuid::Uuid::new_v4().to_string();
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();
    let (done_tx, done_rx) = watch::channel(false);

    // writer 任务：独占 sink，转发写通道消息；通道关闭后主动关闭连接
    tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if sink.send(msg).await.is_err() {
                break;
            }
        }
        let _ = sink.close().await;
    });

    // reader 任务：解析下行事件并 emit 给前端，连接结束时置位 done
    {
        let session_id = session_id.clone();
        let app = app.clone();
        tokio::spawn(async move {
            while let Some(msg) = stream.next().await {
                match msg {
                    Ok(Message::Text(text)) => {
                        match parse_inference_event(&text) {
                            InferenceServerEvent::Result {
                                sentence_end,
                                sentence_id,
                                text,
                                begin_time,
                                end_time,
                            } => {
                                // 心跳结果（sentence_id=0 / heartbeat）跳过
                                if sentence_id <= 0 || text.trim().is_empty() {
                                    continue;
                                }
                                let _ = app.emit(
                                    "dashscope-asr-result",
                                    InferenceResultEvent {
                                        session_id: session_id.clone(),
                                        result_type: if sentence_end { "final".to_string() } else { "interim".to_string() },
                                        item_id: sentence_id.to_string(),
                                        text,
                                        emotion: String::new(),
                                        language: String::new(),
                                    },
                                );
                                let _ = begin_time;
                                let _ = end_time;
                            }
                            InferenceServerEvent::TaskFailed { code, message } => {
                                let _ = app.emit(
                                    "dashscope-asr-error",
                                    InferenceErrorEvent {
                                        session_id: session_id.clone(),
                                        item_id: String::new(),
                                        code,
                                        message,
                                    },
                                );
                                break;
                            }
                            InferenceServerEvent::TaskFinished => {
                                let _ = done_tx.send(true);
                            }
                            _ => {}
                        }
                    }
                    Ok(Message::Close(_)) => {
                        let _ = app.emit(
                            "dashscope-asr-error",
                            InferenceErrorEvent {
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
                            InferenceErrorEvent {
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

    manager.insert_session(session_id.clone(), tx, done_rx).await;
    let _ = task_started;
    Ok(session_id)
}

/// 发送一帧 PCM 音频（新协议为二进制帧；前端按 ~100ms 实时速率发送）
#[tauri::command]
pub async fn dashscope_inference_send_pcm(
    manager: State<'_, DashscopeAsrManager>,
    session_id: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    let (tx, done) = manager
        .get_session(&session_id)
        .await
        .ok_or_else(|| "DashScope session 不存在或已关闭".to_string())?;
    if *done.borrow() {
        return Err("DashScope 连接已断开，发送失败".to_string());
    }
    // 二进制帧直发 PCM（新协议要求二进制音频帧）
    tx.send(Message::Binary(bytes.into()))
        .map_err(|_| "DashScope 连接已断开，发送失败".to_string())
}

/// 结束转写：发 finish-task，等待 task-finished 后清理 session
#[tauri::command]
pub async fn dashscope_inference_finish(
    manager: State<'_, DashscopeAsrManager>,
    session_id: String,
) -> Result<(), String> {
    let (tx, mut done) = manager
        .get_session(&session_id)
        .await
        .ok_or_else(|| "DashScope session 不存在或已关闭".to_string())?;
    tx.send(Message::Text(build_finish_task().to_string().into()))
        .map_err(|_| "DashScope 连接已断开，无法发送 finish-task".to_string())?;

    let result = tokio::time::timeout(FINISH_TIMEOUT, done.wait_for(|v| *v))
        .await
        .map_err(|_| "等待 task-finished 超时".to_string())
        .and_then(|r| r.map(|_| ()).map_err(|_| "DashScope 连接异常结束".to_string()));
    drop(tx);

    manager.remove_session(&session_id).await;
    result
}

/// 异常清理
#[tauri::command]
pub async fn dashscope_inference_disconnect(
    manager: State<'_, DashscopeAsrManager>,
    session_id: String,
) -> Result<(), String> {
    manager.remove_session(&session_id).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose::STANDARD as BASE64;
    use base64::Engine;

    fn test_config() -> DashscopeInferenceConnectConfig {
        DashscopeInferenceConnectConfig {
            api_key: "sk-test".to_string(),
            workspace_id: "ws-test".to_string(),
            language: "zh".to_string(),
            corpus_text: None,
            model: Some("qwen-audio-3.0-asr-flash-streaming".to_string()),
        }
    }

    #[test]
    fn run_task_shape() {
        let value = build_run_task("qwen-audio-3.0-asr-flash-streaming", &test_config());
        assert_eq!(value["header"]["action"], "run-task");
        assert_eq!(value["header"]["streaming"], "duplex");
        assert_eq!(value["payload"]["task_group"], "audio");
        assert_eq!(value["payload"]["task"], "asr");
        assert_eq!(value["payload"]["function"], "recognition");
        assert_eq!(value["payload"]["model"], "qwen-audio-3.0-asr-flash-streaming");
        assert_eq!(value["payload"]["parameters"]["format"], "pcm");
        assert_eq!(value["payload"]["parameters"]["sample_rate"], 16000);
    }

    #[test]
    fn run_task_injects_vocabulary_from_corpus() {
        let mut config = test_config();
        config.corpus_text = Some("招商银行、LPR、大额存单".to_string());
        let value = build_run_task("qwen-audio-3.0-asr-flash-streaming", &config);
        let vocab = &value["payload"]["parameters"]["vocabulary"];
        assert_eq!(vocab["招商银行"], 5);
        assert_eq!(vocab["LPR"], 5);
        assert_eq!(vocab["大额存单"], 5);
    }

    #[test]
    fn finish_task_shape() {
        let value = build_finish_task();
        assert_eq!(value["header"]["action"], "finish-task");
        assert_eq!(value["header"]["streaming"], "duplex");
    }

    #[test]
    fn parse_result_generated() {
        let text = r#"{
            "header": {"task_id": "t1", "event": "result-generated", "attributes": {}},
            "payload": {
                "output": {
                    "sentence": {
                        "begin_time": 170, "end_time": 920,
                        "text": "好，我知道了", "heartbeat": false,
                        "sentence_end": true, "sentence_id": 1,
                        "words": []
                    }
                },
                "usage": {"duration": 3}
            }
        }"#;
        match parse_inference_event(text) {
            InferenceServerEvent::Result { sentence_end, sentence_id, text, .. } => {
                assert!(sentence_end);
                assert_eq!(sentence_id, 1);
                assert_eq!(text, "好，我知道了");
            }
            _ => panic!("should parse as Result"),
        }
    }

    #[test]
    fn parse_task_events() {
        let started = r#"{"header":{"task_id":"t1","event":"task-started","attributes":{}},"payload":{}}"#;
        assert!(matches!(parse_inference_event(started), InferenceServerEvent::TaskStarted));

        let finished = r#"{"header":{"task_id":"t1","event":"task-finished","attributes":{}},"payload":{"output":{},"usage":null}}"#;
        assert!(matches!(parse_inference_event(finished), InferenceServerEvent::TaskFinished));

        let failed = r#"{"header":{"task_id":"t1","event":"task-failed","error_code":"CLIENT_ERROR","error_message":"request timeout"},"payload":{}}"#;
        match parse_inference_event(failed) {
            InferenceServerEvent::TaskFailed { code, message } => {
                assert_eq!(code, "CLIENT_ERROR");
                assert_eq!(message, "request timeout");
            }
            _ => panic!("should parse as TaskFailed"),
        }
    }

    #[test]
    fn binary_pcm_encoding() {
        // 验证二进制帧能经 Message::Binary 正确编码（send 路径的帧类型）
        let pcm: Vec<u8> = vec![0u8, 1, 2, 3, 255, 254];
        let msg = Message::Binary(pcm.clone().into());
        match msg {
            Message::Binary(bytes) => {
                let v: Vec<u8> = bytes.to_vec();
                assert_eq!(v, pcm);
            }
            _ => panic!("should be binary frame"),
        }
    }

    #[test]
    fn base64_roundtrip() {
        let pcm = vec![1u8, 2, 3, 4];
        let b64 = BASE64.encode(&pcm);
        let decoded = BASE64.decode(b64).unwrap();
        assert_eq!(decoded, pcm);
    }
}
