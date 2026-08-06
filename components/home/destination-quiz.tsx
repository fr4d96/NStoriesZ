"use client";

import { useState } from "react";
import Link from "next/link";
import type { StoryCardData } from "@/components/story/story-card";
import type { PublicRegion } from "@/lib/story/public-queries";
import { matchRegion, type RegionMatchSignal } from "@/lib/story/region-match";

type Answer = { label: string; signals: RegionMatchSignal[] };
type Question = { prompt: string; answers: Answer[] };

// Signal names are real work_types/tags column values (see supabase/seed.sql),
// never a hardcoded region -- matchRegion() resolves the actual region from
// whichever real stories carry these signals, so this list only needs to
// describe traits, not guess at the current catalogue's geography.
//
// These strings must still match the work_types/tags lookup tables' free-text
// `name` columns exactly (supabase/migrations/20260803090000_lookup_tables.sql
// has no fixed enum) -- if an editor renames/retranslates a row, the affected
// answer silently stops matching anything instead of erroring.
const QUESTIONS: Question[] = [
  {
    prompt: "What kind of work sounds most like you?",
    answers: [
      {
        label: "☕ Hospitality or café work",
        signals: [{ workType: "Hospitality" }],
      },
      {
        label: "🥝 Fruit picking or orchards",
        signals: [{ workType: "Horticulture" }, { tag: "Fruit picking" }],
      },
      { label: "🍇 Vineyard work", signals: [{ workType: "Viticulture" }] },
      { label: "🐑 Farm work", signals: [{ workType: "Agriculture" }] },
      { label: "🎒 Tourism or activities", signals: [{ workType: "Tourism" }] },
    ],
  },
  {
    prompt: "What matters most on this trip?",
    answers: [
      {
        label: "💰 Saving as much as possible",
        signals: [{ tag: "Budget travel" }],
      },
      { label: "🚐 Freedom to move around", signals: [{ tag: "Road trip" }] },
      { label: "🌱 A season that lasts", signals: [{ tag: "Seasonal work" }] },
      {
        label: "🧭 A proper first adventure",
        signals: [{ tag: "First-time traveller" }],
      },
    ],
  },
  {
    prompt: "Who's coming with you?",
    answers: [
      { label: "🧍 Just me", signals: [{ tag: "Solo travel" }] },
      { label: "💑 My partner", signals: [{ tag: "Couple travel" }] },
      {
        label: "🚌 Whoever I meet along the way",
        signals: [{ tag: "Van life" }],
      },
    ],
  },
  {
    prompt: "Which island calls to you?",
    answers: [
      { label: "🌊 North Island", signals: [{ tag: "North Island" }] },
      { label: "🏔️ South Island", signals: [{ tag: "South Island" }] },
      { label: "🧭 Not sure yet — surprise me", signals: [] },
    ],
  },
];

export function DestinationQuiz({
  stories,
  regions,
}: {
  stories: StoryCardData[];
  regions: PublicRegion[];
}) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<(number | undefined)[]>([]);

  if (stories.length === 0) return null;

  const isResult = step === QUESTIONS.length;
  const progress = Math.round(
    ((isResult ? QUESTIONS.length : step + 1) / QUESTIONS.length) * 100,
  );

  function choose(answerIndex: number) {
    const next = [...answers];
    next[step] = answerIndex;
    setAnswers(next);
    setStep((current) => current + 1);
  }

  function restart() {
    setAnswers([]);
    setStep(0);
  }

  const signals = answers.flatMap((answerIndex, questionIndex) =>
    answerIndex === undefined
      ? []
      : QUESTIONS[questionIndex].answers[answerIndex].signals,
  );
  const result = isResult ? matchRegion(stories, signals) : null;
  const matchedRegion = result
    ? regions.find((region) => region.name === result.regionName)
    : null;

  return (
    <div className="rounded-2xl border border-border-subtle bg-surface p-6 sm:p-8">
      <div className="mb-6 flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-border-subtle">
          <div
            className="h-full rounded-full bg-accent transition-[width]"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-sm font-medium text-foreground/60">
          {isResult ? "Your match" : `${step + 1} / ${QUESTIONS.length}`}
        </span>
      </div>

      {!isResult ? (
        <div>
          <h3 className="text-xl font-semibold tracking-tight sm:text-2xl">
            {QUESTIONS[step].prompt}
          </h3>
          <div className="mt-5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {QUESTIONS[step].answers.map((answer, index) => (
              <button
                key={answer.label}
                type="button"
                data-testid="quiz-answer"
                onClick={() => choose(index)}
                className="min-h-[72px] rounded-xl border border-border-subtle bg-surface-muted p-4 text-left font-medium hover:border-accent hover:bg-surface"
              >
                {answer.label}
              </button>
            ))}
          </div>
          {step > 0 ? (
            <button
              type="button"
              onClick={() => setStep((current) => current - 1)}
              className="mt-5 text-sm font-medium hover:underline"
            >
              ← Back
            </button>
          ) : null}
        </div>
      ) : result ? (
        <div>
          <span className="text-xs font-semibold tracking-wide text-accent uppercase">
            Stories that might interest you
          </span>
          <h3 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            {result.regionName}
          </h3>
          <p className="mt-2 text-sm text-foreground/70">
            {result.storyCount} {result.storyCount === 1 ? "story" : "stories"}{" "}
            in our collection so far
            {result.topWorkType
              ? `, mostly ${result.topWorkType.toLowerCase()}`
              : ""}
            .
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href={
                matchedRegion
                  ? `/stories?region=${matchedRegion.id}`
                  : "/stories"
              }
              className="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-accent-foreground hover:opacity-90"
            >
              Explore stories
            </Link>
            <button
              type="button"
              onClick={restart}
              className="rounded-md border border-border-subtle px-5 py-2.5 text-sm font-medium hover:bg-surface-muted"
            >
              Try again
            </button>
          </div>
        </div>
      ) : (
        <div>
          <h3 className="text-xl font-semibold tracking-tight sm:text-2xl">
            We don&apos;t have a strong match yet
          </h3>
          <p className="mt-2 text-sm text-foreground/70">
            Our catalogue is still growing — browse everything we&apos;ve got
            instead.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/stories"
              className="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-accent-foreground hover:opacity-90"
            >
              Browse all stories
            </Link>
            <button
              type="button"
              onClick={restart}
              className="rounded-md border border-border-subtle px-5 py-2.5 text-sm font-medium hover:bg-surface-muted"
            >
              Try again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
