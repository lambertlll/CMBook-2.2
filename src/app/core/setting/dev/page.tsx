'use client';

import { UserRoundCog } from "lucide-react"
import { SettingDev } from "./setting-dev";

export default function DevPage() {
  return <SettingDev id="dev" icon={<UserRoundCog />} />
}
