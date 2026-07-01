// SPDX-License-Identifier: AGPL-3.0-or-later
import { useRoute } from "wouter";
import SocialPoster from "./SocialPoster";

// Thin route wrapper for `/still/:variant`. Task #588 retired the
// `hero` variant — the landing-page hero now uses a hand-chosen
// self-portrait instead of an auto-regenerated room screenshot — so
// the only supported variant is `social` (1200x630, X/nostr OG
// embed standard, 1.91:1), which is rendered by `SocialPoster`.
//
// The actual social capture logic lives in `SocialPoster.tsx` on
// purpose: the still-poster drift checker watches that module (not
// this wrapper), so adding or removing variants here does not
// require regenerating the social JPEG.
export default function StillPoster() {
  useRoute("/still/:variant");
  return <SocialPoster />;
}
