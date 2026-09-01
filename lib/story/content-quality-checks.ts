import {
  storyContentText,
  type StoryContentBlock,
} from "@/lib/validation/story";
import { markdownToPlainText } from "@/lib/story/markdown-text";

// Advisory-only heuristics for the founding-catalogue readiness workflow.
// These never block submission/approval and are not run as part of any
// database constraint or RPC -- per Prompt 7's own brief, "automated checks
// may flag content but must not automatically decide publication." An editor
// or moderator reads the findings and decides; nothing here mutates state.

export type QualityCheckSeverity = "info" | "warning";

export type QualityCheckFinding = {
  code: string;
  severity: QualityCheckSeverity;
  message: string;
};

export type QualityCheckMediaInput = {
  altText: string | null;
  decorative: boolean;
  imageRightsConfirmed: boolean;
};

export type QualityCheckInput = {
  title: string;
  excerpt?: string | null;
  contentBlocks: StoryContentBlock[];
  tripStartDate?: string | null;
  tripEndDate?: string | null;
  tripYear?: number | null;
  hasRegion: boolean;
  hasTag: boolean;
  media?: QualityCheckMediaInput[];
};

// Strips Markdown syntax down to roughly what a reader would see -- good
// enough for word-count/regex heuristics below, not a full renderer. The
// stripping itself now lives in lib/story/markdown-text.ts, shared with the
// contributor-facing live word count so the two can't disagree. That move
// also fixed a real gap: the old embed-token pattern here
// (`!\[\[[0-9a-fA-F-]{36}\]\]`) predated the `|<width>` suffix added on
// 2026-08-12, so a resized image's token leaked "320" into this plain text
// and was counted as a word.
function extractPlainText(blocks: StoryContentBlock[]): string {
  return markdownToPlainText(storyContentText(blocks));
}

const MARKDOWN_LINK_RE = /\[[^\]\n]*\]\([^)\n]*\)/g;

function countLinkMarks(blocks: StoryContentBlock[]): number {
  const matches = storyContentText(blocks).match(MARKDOWN_LINK_RE);
  return matches ? matches.length : 0;
}

// Deliberately small, conservative word lists -- these exist to prompt a
// human to look closer, not to auto-detect anything with confidence. False
// positives are expected and acceptable (advisory, non-blocking); false
// negatives are far more likely than false positives given the narrow lists.
const VISA_EMPLOYMENT_CLAIM_PATTERNS = [
  /\bguaranteed\s+(visa|job|work|pr|residency)\b/i,
  /\b(100%|definitely will)\s+(get|approve|approved)\b/i,
  /\bany\s+employer\s+will\s+(hire|sponsor)\b/i,
  /\bvisa\s+is\s+guaranteed\b/i,
];

const ADDRESS_PATTERN =
  /\b\d{1,5}\s+[A-Za-z0-9.'-]+\s+(Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Place|Pl|Court|Ct|Highway|Hwy)\b/i;

const LIVE_LOCATION_PATTERN =
  /\b(i\s+(currently\s+)?live\s+at|my\s+address\s+is|-?\d{1,3}\.\d{3,},\s*-?\d{1,3}\.\d{3,})\b/i;

const IDENTIFYING_DETAIL_PATTERNS = [
  /\bpassport\s*(no\.?|number)\b/i,
  /\b(nric|ic\s*number)\b/i,
  /\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/i, // email address
  /\b\+?\d[\d\s-]{7,}\d\b/, // phone-number-shaped digit run
];

const EMPLOYER_ACCUSATION_PATTERNS = [
  /\brefused to pay\b/i,
  /\bscammed (us|me)\b/i,
  /\billegal(ly)? (underpaid|withheld|deducted)\b/i,
  /\bnamed and shamed?\b/i,
];

export function runContentQualityChecks(
  input: QualityCheckInput,
): QualityCheckFinding[] {
  const findings: QualityCheckFinding[] = [];
  const plainText = extractPlainText(input.contentBlocks);
  const wordCount =
    plainText.trim().length === 0 ? 0 : plainText.trim().split(/\s+/).length;

  if (wordCount < 150) {
    findings.push({
      code: "missing_trip_context",
      severity: "info",
      message:
        "The story body is quite short -- consider whether it gives readers enough real trip context.",
    });
  }

  if (!input.tripStartDate && !input.tripEndDate && !input.tripYear) {
    findings.push({
      code: "unclear_dates",
      severity: "warning",
      message: "No trip start/end date or trip year is set.",
    });
  }

  if (!input.hasRegion) {
    findings.push({
      code: "missing_region",
      severity: "warning",
      message: "No region is selected for this story.",
    });
  }

  if (!input.hasTag) {
    findings.push({
      code: "missing_tags",
      severity: "info",
      message:
        "No tags are selected for this story -- tags are how readers find it.",
    });
  }

  if (
    VISA_EMPLOYMENT_CLAIM_PATTERNS.some((pattern) => pattern.test(plainText))
  ) {
    findings.push({
      code: "unsupported_visa_or_employment_claim",
      severity: "warning",
      message:
        'The text may contain an absolute visa/employment claim (e.g. "guaranteed") -- this platform publishes personal experience, not advice or guarantees. Review the wording.',
    });
  }

  if (
    ADDRESS_PATTERN.test(plainText) ||
    LIVE_LOCATION_PATTERN.test(plainText)
  ) {
    findings.push({
      code: "exact_address_or_live_location",
      severity: "warning",
      message:
        "The text may contain a specific street address or a live-location statement. Confirm this isn't an exact residential address before publishing.",
    });
  }

  if (IDENTIFYING_DETAIL_PATTERNS.some((pattern) => pattern.test(plainText))) {
    findings.push({
      code: "potentially_identifying_detail",
      severity: "warning",
      message:
        "The text may contain a potentially identifying detail (email, phone number, passport/ID number). Review before publishing.",
    });
  }

  if (EMPLOYER_ACCUSATION_PATTERNS.some((pattern) => pattern.test(plainText))) {
    findings.push({
      code: "employer_accusation_or_allegation",
      severity: "warning",
      message:
        "The text may name or accuse a specific employer. Review for identifiable allegations/defamation risk per docs/moderation-guidelines.md.",
    });
  }

  const linkCount = countLinkMarks(input.contentBlocks);
  if (linkCount > 2) {
    findings.push({
      code: "excessive_promotional_links",
      severity: "info",
      message: `The story contains ${linkCount} links -- review for excessive promotion.`,
    });
  }

  const media = input.media ?? [];
  const missingAltTextCount = media.filter(
    (m) => !m.decorative && (!m.altText || m.altText.trim().length === 0),
  ).length;
  if (missingAltTextCount > 0) {
    findings.push({
      code: "images_missing_alt_text",
      severity: "warning",
      message: `${missingAltTextCount} image(s) are missing alt text.`,
    });
  }

  const unresolvedRightsCount = media.filter(
    (m) => !m.imageRightsConfirmed,
  ).length;
  if (unresolvedRightsCount > 0) {
    findings.push({
      code: "images_with_unresolved_rights",
      severity: "warning",
      message: `${unresolvedRightsCount} image(s) have unresolved rights confirmation.`,
    });
  }

  return findings;
}
