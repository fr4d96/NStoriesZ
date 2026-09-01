import { afterEach, describe, expect, it, vi } from "vitest";

// server-only's package code throws unconditionally outside Next's own
// bundler, so it has to be stubbed to import lib/log.ts here at all -- same
// approach lib/story/image-pipeline.test.ts already uses and documents.
vi.mock("server-only", () => ({}));

const { logAppEvent, logStaffAction } = await import("./log");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logAppEvent", () => {
  it("writes an error to console.error, tagged scope: app-event", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    logAppEvent({
      event: "pdf-import.alt_text_partial",
      target: "11111111-1111-4111-8111-111111111111",
      outcome: "error",
      detail: "applied 2 of 5",
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed).toMatchObject({
      scope: "app-event",
      event: "pdf-import.alt_text_partial",
      target: "11111111-1111-4111-8111-111111111111",
      outcome: "error",
      detail: "applied 2 of 5",
    });
    expect(typeof parsed.ts).toBe("string");
  });

  it("writes a success to console.log, not console.error", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    logAppEvent({
      event: "pdf-import.alt_text_partial",
      target: "11111111-1111-4111-8111-111111111111",
      outcome: "success",
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  // The distinct `scope` is the whole point of having two functions rather
  // than one: an app event is operational only and deliberately carries NO
  // actor, so it can never quietly become a per-user audit trail the way a
  // staff action legitimately is.
  it("carries no actor field, unlike logStaffAction", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    logAppEvent({
      event: "pdf-import.alt_text_partial",
      target: "11111111-1111-4111-8111-111111111111",
      outcome: "error",
    });
    const appEvent = JSON.parse(spy.mock.calls[0][0] as string);
    expect(appEvent).not.toHaveProperty("actor");
    expect(appEvent.scope).toBe("app-event");

    spy.mockClear();

    logStaffAction({
      actor: "22222222-2222-4222-8222-222222222222",
      action: "moderation.archive",
      target: "11111111-1111-4111-8111-111111111111",
      outcome: "error",
    });
    const staffAction = JSON.parse(spy.mock.calls[0][0] as string);
    expect(staffAction.actor).toBe("22222222-2222-4222-8222-222222222222");
    expect(staffAction.scope).toBe("staff-action");
  });
});
