'use client';
import { SettingType } from "../components/setting-base";
import { Setting } from "./setting";
import { Presentation } from "lucide-react"
import { useTranslations } from "next-intl";

export default function MeetingPage() {
  const t = useTranslations('settings.meeting');

  return <SettingType id="meeting" icon={<Presentation />} title={t('title')} desc={t('desc')}>
    <Setting />
  </SettingType>
}
