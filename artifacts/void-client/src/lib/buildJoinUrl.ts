// SPDX-License-Identifier: AGPL-3.0-or-later
import { phraseToHash } from "./voidPhrase";

export function buildJoinUrl(phrase: string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}${phraseToHash(phrase)}`;
}
