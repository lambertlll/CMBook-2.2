import { Item, ItemGroup, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item';
import { useTranslations } from 'next-intl';
import { ModelSelect } from "../components/model-select";
import { Gauge, Volume2, Mic, Flame, Users } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useState, useEffect } from "react";
import { Store } from "@tauri-apps/plugin-store";
import useSettingStore from "@/stores/setting";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SpeechMode } from '@/lib/speech/types';

/**
 * ASR 模型名 → i18n key 映射。
 * next-intl 的 JSON key 不允许含 "."（用作嵌套分隔符），
 * 而模型名 qwen-audio-3.0-asr-flash 带点号，故转义为下划线。
 */
function modelI18nKey(model: string): string {
  return model.replace(/\./g, '_');
}

export function Setting() {
  const t = useTranslations('settings.audio');
  const {
    audioModel,
    textToSpeechMode,
    setAiModelList,
    setTextToSpeechMode,
    sttEngine,
    setSttEngine,
    aliyunAsrApiKey,
    setAliyunAsrApiKey,
    aliyunAsrWorkspaceId,
    setAliyunAsrWorkspaceId,
  } = useSettingStore();
  const [speed, setSpeed] = useState(1);
  // 阿里云 ASR 热词与说话人分离（selector 精确订阅）
  const aliyunAsrHotwords = useSettingStore((s) => s.aliyunAsrHotwords);
  const setAliyunAsrHotwords = useSettingStore((s) => s.setAliyunAsrHotwords);
  const aliyunAsrDiarization = useSettingStore((s) => s.aliyunAsrDiarization);
  const setAliyunAsrDiarization = useSettingStore((s) => s.setAliyunAsrDiarization);
  // 阿里云 ASR 识别模型（selector 精确订阅）
  const aliyunAsrModel = useSettingStore((s) => s.aliyunAsrModel);
  const setAliyunAsrModel = useSettingStore((s) => s.setAliyunAsrModel);
  // Qwen3/Qwen-Audio ASR 系列（含 realtime/streaming）不支持说话人分离
  const diarizationUnsupported =
    aliyunAsrModel === 'qwen3-asr-flash' ||
    aliyunAsrModel === 'qwen3-asr-flash-realtime' ||
    aliyunAsrModel === 'qwen-audio-3.0-asr-flash' ||
    aliyunAsrModel === 'qwen-audio-3.0-asr-flash-streaming';
  const modeOptions: Array<{ value: SpeechMode; label: string }> = [
    { value: 'auto', label: t('mode.auto') },
    { value: 'local', label: t('mode.local') },
    { value: 'model', label: t('mode.model') },
  ];

  // 加载TTS语速设置
  useEffect(() => {
    async function loadSpeed() {
      if (!audioModel) return;
      const store = await Store.load('store.json');
      const models = await store.get<any[]>('aiModelList');
      if (!models) return;
      
      // 查找TTS模型配置，适配新的多模型数据结构
      let currentSpeed = 1;
      for (const config of models) {
        // 检查新的 models 数组结构
        if (config.models && config.models.length > 0) {
          const targetModel = config.models.find((model: any) => 
            model.id === audioModel && model.modelType === 'tts'
          );
          if (targetModel && targetModel.speed !== undefined) {
            currentSpeed = targetModel.speed;
            break;
          }
        } else {
          // 向后兼容：处理旧的单模型结构
          if (config.key === audioModel && config.modelType === 'tts' && config.speed !== undefined) {
            currentSpeed = config.speed;
            break;
          }
        }
      }
      
      setSpeed(currentSpeed);
      setAiModelList(models);
    }
    loadSpeed();
  }, [audioModel]);

  // 保存TTS语速设置
  const handleSpeedChange = async (value: number[]) => {
    const newSpeed = value[0];
    setSpeed(newSpeed);
    
    if (!audioModel) return;
    
    const store = await Store.load('store.json');
    const models = await store.get<any[]>('aiModelList') || [];
    
    // 更新TTS模型的语速设置，适配新的多模型数据结构
    const updatedModels = models.map(config => {
      // 检查新的 models 数组结构
      if (config.models && config.models.length > 0) {
        const updatedConfig = { ...config };
        updatedConfig.models = config.models.map((model: any) => {
          if (model.id === audioModel && model.modelType === 'tts') {
            return { ...model, speed: newSpeed };
          }
          return model;
        });
        return updatedConfig;
      } else {
        // 向后兼容：处理旧的单模型结构
        if (config.key === audioModel && config.modelType === 'tts') {
          return { ...config, speed: newSpeed };
        }
        return config;
      }
    });
    
    setAiModelList(updatedModels);
    await store.set('aiModelList', updatedModels);
    await store.save();
  };

  return (
    <ItemGroup className="gap-6">
      {/* TTS朗读设置部分 */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">{t('tts.title')}</h3>
        <p className="text-xs text-muted-foreground">{t('tts.desc')}</p>
      </div>

      <ItemGroup className="gap-4">
        <Item variant="outline">
          <ItemMedia variant="icon"><Volume2 className="size-4" /></ItemMedia>
          <ItemContent>
            <ItemTitle>{t('mode.title')}</ItemTitle>
            <ItemDescription>{t('tts.modeDesc')}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Select value={textToSpeechMode} onValueChange={(value) => setTextToSpeechMode(value as SpeechMode)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {modeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </ItemActions>
        </Item>

        <Item variant="outline">
          <ItemMedia variant="icon"><Volume2 className="size-4" /></ItemMedia>
          <ItemContent>
            <ItemTitle>{t('tts.model.title')}</ItemTitle>
            <ItemDescription>{t('tts.model.desc')}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <ModelSelect modelKey="tts" />
          </ItemActions>
        </Item>

        {audioModel && (
          <Item variant="outline">
            <ItemMedia variant="icon"><Gauge className="size-4" /></ItemMedia>
            <ItemContent>
              <ItemTitle>{t('tts.speed.title')}</ItemTitle>
              <ItemDescription>{t('tts.speed.desc')}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <div className="flex items-center gap-4">
                <Slider
                  value={[speed]}
                  onValueChange={handleSpeedChange}
                  min={0.5}
                  max={2}
                  step={0.1}
                  className="w-[180px]"
                />
                <span className="text-muted-foreground w-10">{speed}x</span>
              </div>
            </ItemActions>
          </Item>
        )}
      </ItemGroup>

      {/* STT语音识别设置部分 */}
      <div className="space-y-2 mt-8">
        <h3 className="text-sm font-medium text-foreground">{t('stt.title')}</h3>
        <p className="text-xs text-muted-foreground">{t('stt.desc')}</p>
      </div>

      <ItemGroup className="gap-4">
        <Item variant="outline">
          <ItemMedia variant="icon"><Mic className="size-4" /></ItemMedia>
          <ItemContent>
            <ItemTitle>转写引擎</ItemTitle>
            <ItemDescription>选择语音转文字服务提供商</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Select value={sttEngine} onValueChange={(value) => setSttEngine(value as 'openai-compatible' | 'aliyun')}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai-compatible">OpenAI 兼容（硅基流动等）</SelectItem>
                <SelectItem value="aliyun">阿里云百炼 ASR</SelectItem>
              </SelectContent>
            </Select>
          </ItemActions>
        </Item>

        {sttEngine === 'openai-compatible' && (
          <Item variant="outline">
            <ItemMedia variant="icon"><Mic className="size-4" /></ItemMedia>
            <ItemContent>
              <ItemTitle>{t('stt.model.title')}</ItemTitle>
              <ItemDescription>{t('stt.model.desc')}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <ModelSelect modelKey="stt" />
            </ItemActions>
          </Item>
        )}

        {sttEngine === 'aliyun' && (
          <>
            <Item variant="outline">
              <ItemMedia variant="icon"><Mic className="size-4" /></ItemMedia>
              <ItemContent>
                <ItemTitle>API Key</ItemTitle>
                <ItemDescription>阿里云百炼 API Key（以 sk- 开头）</ItemDescription>
              </ItemContent>
              <ItemActions>
                <Input
                  type="password"
                  value={aliyunAsrApiKey}
                  onChange={(e) => setAliyunAsrApiKey(e.target.value)}
                  placeholder="sk-..."
                  className="w-[280px]"
                />
              </ItemActions>
            </Item>
            <Item variant="outline">
              <ItemMedia variant="icon"><Mic className="size-4" /></ItemMedia>
              <ItemContent>
                <ItemTitle>业务空间 ID</ItemTitle>
                <ItemDescription>百炼控制台的 WorkspaceId</ItemDescription>
              </ItemContent>
              <ItemActions>
                <Input
                  value={aliyunAsrWorkspaceId}
                  onChange={(e) => setAliyunAsrWorkspaceId(e.target.value)}
                  placeholder="ws-xxxxxxxx"
                  className="w-[280px]"
                />
              </ItemActions>
            </Item>
            <Item variant="outline">
              <ItemMedia variant="icon"><Mic className="size-4" /></ItemMedia>
              <ItemContent>
                <ItemTitle>{t('stt.aliyun.model.title')}</ItemTitle>
                <ItemDescription>{t(`stt.aliyun.model.${modelI18nKey(aliyunAsrModel)}`)}</ItemDescription>
              </ItemContent>
              <ItemActions>
                <Select value={aliyunAsrModel} onValueChange={(value) => setAliyunAsrModel(value as 'fun-asr' | 'qwen3-asr-flash' | 'paraformer-v2' | 'qwen3-asr-flash-realtime' | 'qwen-audio-3.0-asr-flash' | 'qwen-audio-3.0-asr-flash-streaming')}>
                  <SelectTrigger className="w-[220px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fun-asr">Fun-ASR</SelectItem>
                    <SelectItem value="qwen3-asr-flash">Qwen3-ASR-Flash</SelectItem>
                    <SelectItem value="qwen3-asr-flash-realtime">Qwen3-ASR-Flash-Realtime</SelectItem>
                    <SelectItem value="qwen-audio-3.0-asr-flash">Qwen-Audio-3.0-ASR-Flash</SelectItem>
                    <SelectItem value="qwen-audio-3.0-asr-flash-streaming">Qwen-Audio-3.0-ASR-Flash-Streaming</SelectItem>
                    <SelectItem value="paraformer-v2">Paraformer-v2</SelectItem>
                  </SelectContent>
                </Select>
              </ItemActions>
            </Item>
            <Item variant="outline">
              <ItemMedia variant="icon"><Users className="size-4" /></ItemMedia>
              <ItemContent>
                <ItemTitle>{t('stt.aliyun.diarization.title')}</ItemTitle>
                <ItemDescription>
                  {diarizationUnsupported ? t('stt.aliyun.diarization.unsupported') : t('stt.aliyun.diarization.desc')}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Switch
                  checked={aliyunAsrDiarization}
                  onCheckedChange={setAliyunAsrDiarization}
                  disabled={diarizationUnsupported}
                />
              </ItemActions>
            </Item>
            <Item variant="outline">
              <ItemMedia variant="icon"><Flame className="size-4" /></ItemMedia>
              <ItemContent>
                <ItemTitle>{t('stt.aliyun.hotwords.title')}</ItemTitle>
                <ItemDescription>{t('stt.aliyun.hotwords.desc')}</ItemDescription>
              </ItemContent>
              <ItemActions>
                <Textarea
                  value={aliyunAsrHotwords}
                  onChange={(e) => setAliyunAsrHotwords(e.target.value)}
                  placeholder={t('stt.aliyun.hotwords.placeholder')}
                  className="w-[280px] min-h-20"
                />
              </ItemActions>
            </Item>
          </>
        )}
      </ItemGroup>
    </ItemGroup>
  )
}
