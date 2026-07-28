'use client';
import { SettingType } from "../components/setting-base";
import { Setting } from "./setting";
import { Globe } from "lucide-react"
import { useTranslations } from "next-intl";

export default function WebSearchPage() {
  const t = useTranslations('settings.websearch');

  return <SettingType id="websearch" icon={<Globe />} title={t('title')} desc={t('desc')}>
    <Setting />
  </SettingType>
}
