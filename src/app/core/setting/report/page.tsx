'use client';
import { SettingType } from "../components/setting-base";
import { Setting } from "./setting";
import { ClipboardList } from "lucide-react"
import { useTranslations } from "next-intl";

export default function ReportPage() {
  const t = useTranslations('settings.report');

  return <SettingType id="report" icon={<ClipboardList />} title={t('title')} desc={t('desc')}>
    <Setting />
  </SettingType>
}
