import React from "react";
import { Channel } from "@/src/api";
import { PurpleChannelCollection } from "@/src/components/PurpleChannelCollection";
import { useTvBackToGuide } from "@/src/hooks/use-tv-back-to-guide";

const matchesMovies = (channel: Channel) =>
  /movie|movies|cinema|film|films|vod/i.test(`${channel.group || ""} ${channel.name || ""}`);

export default function MoviesScreen() {
  useTvBackToGuide();
  return (
    <PurpleChannelCollection
      active="/movies"
      title="Movies"
      subtitle="Browse movie channels"
      matcher={matchesMovies}
    />
  );
}
