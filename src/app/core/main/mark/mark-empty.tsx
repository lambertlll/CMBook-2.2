import { Highlighter } from "lucide-react";
import { useTranslations } from 'next-intl';

export default function MarkEmpty() {
  const t = useTranslations();
  return <div className="flex flex-col justify-center items-center flex-1 w-full pt-32">
    <Highlighter className="size-16 opacity-10 mb-2" />
    <p className='text-muted-foreground opacity-30'>{t('record.mark.empty')}</p>
  </div>
}