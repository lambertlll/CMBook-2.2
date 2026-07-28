'use client';
import { SettingType } from "../components/setting-base";
import { useTranslations } from 'next-intl';
import useSettingStore from '@/stores/setting';
import Image from 'next/image';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { OpenBroswer } from '@/components/open-broswer';

export function SettingAbout({id, icon}: {id: string, icon?: React.ReactNode}) {
  const t = useTranslations('settings.about');
  const version = useSettingStore((s) => s.version);

  return (
    <SettingType id={id} icon={icon} title={t('title')}>
      <div className="flex w-full flex-col gap-6">
        <section className="flex flex-col gap-3">
          <SectionHeading title={t('sections.appInfo.title')} desc={t('sections.appInfo.desc')} />
          <Card className="overflow-hidden">
            <CardHeader className="p-5">
              <div className="flex min-w-0 items-center gap-3">
                <Image src="/app-icon.png" alt="CMBook logo" className="size-14 shrink-0 dark:invert" width={56} height={56} />
                <div className="flex min-w-0 flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="text-xl font-semibold leading-none">CMBook</CardTitle>
                    <Badge variant="outline">v{version}</Badge>
                  </div>
                  <CardDescription className="text-sm font-medium leading-none">
                    {t('desc')}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
          </Card>
        </section>

        {/* 开源致谢：基于 NoteGen 二次开发，遵循原项目 GPL-3.0 协议 */}
        <section className="flex flex-col gap-3">
          <SectionHeading title={t('sections.acknowledgements.title')} desc={t('sections.acknowledgements.desc')} />
          <Card>
            <CardContent className="flex flex-col gap-3 p-5 text-sm text-muted-foreground">
              <p>{t('acknowledgements.basedOn')}</p>
              <p>{t('acknowledgements.license')}</p>
              <OpenBroswer
                title="NoteGen · codexu/note-gen"
                url="https://github.com/codexu/note-gen"
                className="w-fit text-sm text-primary hover:underline"
              />
            </CardContent>
          </Card>
        </section>

        <p className="text-xs text-muted-foreground">{t('licenseText')}</p>
      </div>
    </SettingType>
  )
}

function SectionHeading({ title, desc }: { title: string, desc: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground">{desc}</p>
    </div>
  )
}
