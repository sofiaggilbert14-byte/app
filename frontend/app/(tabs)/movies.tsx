import React from "react";
import { Channel } from "@/src/api";
import { PurpleChannelCollection } from "@/src/components/PurpleChannelCollection";

const matchesMovies = (channel: Channel) =>
  /movie|movies|cinema|film|films|vod/i.test(`${channel.group || ""} ${channel.name || ""}`);

export default function MoviesScreen() {
  return (
    <PurpleChannelCollection
      active="/movies"
      title="Movies"
      subtitle="Browse movie channels"
      matcher={matchesMovies}
    />
  );
}
