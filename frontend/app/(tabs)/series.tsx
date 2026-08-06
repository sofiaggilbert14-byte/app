import React from "react";
import { Channel } from "@/src/api";
import { PurpleChannelCollection } from "@/src/components/PurpleChannelCollection";
import { useTvBackToGuide } from "@/src/hooks/use-tv-back-to-guide";

const matchesSeries = (channel: Channel) =>
  /series|show|shows|entertainment|drama|comedy|sitcom/i.test(`${channel.group || ""} ${channel.name || ""}`);

export default function SeriesScreen() {
  useTvBackToGuide();
  return (
    <PurpleChannelCollection
      active="/series"
      title="Series"
      subtitle="Browse series and entertainment"
      matcher={matchesSeries}
    />
  );
}
