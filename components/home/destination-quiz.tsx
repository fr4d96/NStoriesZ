"use client";

import { useState } from "react";
import Link from "next/link";

type Answer = { label: string; scores: Record<string, number> };
type Question = { prompt: string; answers: Answer[] };

// Deliberately hardcoded -- a fixed, fun scoring quiz, not a real
// recommendation engine. Does not read from Supabase or compare against
// any published story/region data; the destinations named here don't need
// to match whatever regions currently exist in the catalogue.
const QUESTIONS: Question[] = [
  {
    prompt: "Where would you feel most at home?",
    answers: [
      { label: "🏙️ A lively city", scores: { Auckland: 3, Wellington: 3 } },
      { label: "🌊 A relaxed coastal town", scores: { "Bay of Plenty": 4 } },
      {
        label: "🏔️ Mountains and alpine scenery",
        scores: { "Queenstown Lakes": 5, "Central Otago": 2 },
      },
      { label: "🌾 Open countryside", scores: { Canterbury: 5 } },
      {
        label: "🧺 A seasonal-work community",
        scores: { "Bay of Plenty": 3, "Central Otago": 3 },
      },
    ],
  },
  {
    prompt: "What kind of job would you try?",
    answers: [
      {
        label: "☕ Hospitality or café work",
        scores: { Wellington: 4, Auckland: 3 },
      },
      { label: "🥝 Fruit picking", scores: { "Bay of Plenty": 5 } },
      { label: "🐑 Farm work", scores: { Canterbury: 5 } },
      { label: "🎿 Ski-field work", scores: { "Queenstown Lakes": 6 } },
      { label: "🍇 Vineyard work", scores: { "Central Otago": 6 } },
    ],
  },
  {
    prompt: "What matters most?",
    answers: [
      {
        label: "💰 Saving money",
        scores: { "Bay of Plenty": 4, Canterbury: 2 },
      },
      {
        label: "🤝 Meeting people",
        scores: { Auckland: 3, "Queenstown Lakes": 3 },
      },
      {
        label: "🥾 Time outdoors",
        scores: { Canterbury: 3, "Queenstown Lakes": 4 },
      },
      {
        label: "🧰 Useful experience",
        scores: { Auckland: 3, Wellington: 3 },
      },
      {
        label: "🗺️ Work and travel balance",
        scores: { Wellington: 3, "Central Otago": 3 },
      },
    ],
  },
  {
    prompt: "Choose your ideal pace.",
    answers: [
      {
        label: "✨ Busy and social",
        scores: { Auckland: 4, "Queenstown Lakes": 3 },
      },
      {
        label: "🌅 Relaxed and scenic",
        scores: { "Bay of Plenty": 3, "Central Otago": 4 },
      },
      {
        label: "🚴 Active and physical",
        scores: { Canterbury: 3, "Queenstown Lakes": 4 },
      },
      {
        label: "🚐 Independent and flexible",
        scores: { Canterbury: 2, "Central Otago": 3 },
      },
    ],
  },
  {
    prompt: "Which season sounds best?",
    answers: [
      { label: "☀️ Summer", scores: { Auckland: 2, "Bay of Plenty": 3 } },
      {
        label: "🍂 Autumn",
        scores: { "Central Otago": 5, "Bay of Plenty": 3 },
      },
      { label: "❄️ Winter", scores: { "Queenstown Lakes": 6 } },
      { label: "🌱 Spring", scores: { Canterbury: 4, Wellington: 2 } },
      {
        label: "🧭 Flexible",
        scores: {
          Auckland: 1,
          Wellington: 1,
          Canterbury: 1,
          "Bay of Plenty": 1,
          "Queenstown Lakes": 1,
          "Central Otago": 1,
        },
      },
    ],
  },
];

const DESTINATION_INFO: Record<
  string,
  { season: string; work: string; note: string }
> = {
  Auckland: {
    season: "Year-round",
    work: "Hospitality · Retail",
    note: "Compare rent and commuting costs.",
  },
  Wellington: {
    season: "Spring",
    work: "Cafés · Events",
    note: "Expect wind and a competitive rental market.",
  },
  Canterbury: {
    season: "Spring",
    work: "Farm work · Warehousing",
    note: "Transport helps for rural roles.",
  },
  "Bay of Plenty": {
    season: "Autumn",
    work: "Fruit picking · Packhouse",
    note: "Hours can depend on weather.",
  },
  "Queenstown Lakes": {
    season: "Winter",
    work: "Ski fields · Hospitality",
    note: "Plan accommodation early.",
  },
  "Central Otago": {
    season: "Autumn",
    work: "Vineyards · Orchards",
    note: "Line up your next seasonal move.",
  },
};

const DEFAULT_DESTINATION = "Auckland";

export function DestinationQuiz() {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<(number | undefined)[]>([]);

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

  function computeDestination(): string {
    const totals: Record<string, number> = {};
    answers.forEach((answerIndex, questionIndex) => {
      if (answerIndex === undefined) return;
      const scores = QUESTIONS[questionIndex].answers[answerIndex].scores;
      for (const [destination, points] of Object.entries(scores)) {
        totals[destination] = (totals[destination] ?? 0) + points;
      }
    });
    const ranked = Object.entries(totals).sort((a, b) => b[1] - a[1]);
    return ranked[0]?.[0] ?? DEFAULT_DESTINATION;
  }

  const destination = isResult ? computeDestination() : null;
  const facts = destination ? DESTINATION_INFO[destination] : null;

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
      ) : (
        <div>
          <span className="text-xs font-semibold tracking-wide text-accent uppercase">
            Your working holiday match
          </span>
          <h3 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            {destination}
          </h3>
          {facts ? (
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="rounded-lg bg-surface-muted p-3">
                <span className="block text-xs text-foreground/60">
                  Best season
                </span>
                <strong className="text-sm">{facts.season}</strong>
              </div>
              <div className="rounded-lg bg-surface-muted p-3">
                <span className="block text-xs text-foreground/60">Work</span>
                <strong className="text-sm">{facts.work}</strong>
              </div>
              <div className="rounded-lg bg-surface-muted p-3">
                <span className="block text-xs text-foreground/60">
                  Practical note
                </span>
                <strong className="text-sm">{facts.note}</strong>
              </div>
            </div>
          ) : null}
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="#discover"
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
      )}
    </div>
  );
}
