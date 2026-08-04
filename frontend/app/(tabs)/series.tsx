import React from "react";
import { Channel } from "@/src/api";
import { PurpleChannelCollection } from "@/src/components/PurpleChannelCollection";

const matchesSeries = (channel: Channel) =>
  /series|show|shows|entertainment|drama|comedy|sitcom/i.test(`${channel.group || ""} ${channel.name || ""}`);

export default function SeriesScreen() {
  return (
    <PurpleChannelCollection
      active="/series"
      title="Series"
      subtitle="Browse series and entertainment"
      matcher={matchesSeries}
    />
  );
}
