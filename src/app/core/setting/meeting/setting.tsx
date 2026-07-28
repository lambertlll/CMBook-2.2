import { Item, ItemGroup, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item';
import { useTranslations } from 'next-intl';
import { SpellCheck, ListChecks, Users } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import useSettingStore from "@/stores/setting";
import { MeetingTemplateManager } from './meeting-template-manager';

export function Setting() {
  const t = useTranslations('settings.meeting');
  // 会议纪要增强开关（selector 精确订阅）
  const meetingTranscriptCorrection = useSettingStore((s) => s.meetingTranscriptCorrection);
  const setMeetingTranscriptCorrection = useSettingStore((s) => s.setMeetingTranscriptCorrection);
  const meetingCoverageCheck = useSettingStore((s) => s.meetingCoverageCheck);
  const setMeetingCoverageCheck = useSettingStore((s) => s.setMeetingCoverageCheck);
  const meetingAutoDiarize = useSettingStore((s) => s.meetingAutoDiarize);
  const setMeetingAutoDiarize = useSettingStore((s) => s.setMeetingAutoDiarize);

  return (
    <ItemGroup className="gap-4">
      <Item variant="outline">
        <ItemMedia variant="icon"><SpellCheck className="size-4" /></ItemMedia>
        <ItemContent>
          <ItemTitle>{t('transcriptCorrection.title')}</ItemTitle>
          <ItemDescription>{t('transcriptCorrection.desc')}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Switch
            checked={meetingTranscriptCorrection}
            onCheckedChange={setMeetingTranscriptCorrection}
          />
        </ItemActions>
      </Item>

      <Item variant="outline">
        <ItemMedia variant="icon"><ListChecks className="size-4" /></ItemMedia>
        <ItemContent>
          <ItemTitle>{t('coverageCheck.title')}</ItemTitle>
          <ItemDescription>{t('coverageCheck.desc')}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Switch
            checked={meetingCoverageCheck}
            onCheckedChange={setMeetingCoverageCheck}
          />
        </ItemActions>
      </Item>

      <Item variant="outline">
        <ItemMedia variant="icon"><Users className="size-4" /></ItemMedia>
        <ItemContent>
          <ItemTitle>{t('autoDiarize.title')}</ItemTitle>
          <ItemDescription>{t('autoDiarize.desc')}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Switch
            checked={meetingAutoDiarize}
            onCheckedChange={setMeetingAutoDiarize}
          />
        </ItemActions>
      </Item>

      {/* 自定义纪要模板管理 */}
      <MeetingTemplateManager />
    </ItemGroup>
  )
}
