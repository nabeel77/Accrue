import 'server-only';

const A_BUILD_HAS_FORTY_SECONDS = 40_000;

export interface Step {
  readonly name: string;
  readonly milliseconds: number;
}

export interface StepTimer {
  at<Result>(name: string, work: () => Promise<Result>): Promise<Result>;
  current(): string;
  taken(): readonly Step[];
}

export class TheBuildTookTooLong extends Error {
  constructor(readonly step: string) {
    super(`the build was still ${step} after forty seconds`);
    this.name = 'TheBuildTookTooLong';
  }
}

export function stepTimer(): StepTimer {
  const taken: Step[] = [];
  let current = 'starting';
  return {
    async at(name, work) {
      current = name;
      const startedAt = Date.now();
      try {
        return await work();
      } finally {
        taken.push({ name, milliseconds: Date.now() - startedAt });
        current = `done ${name}`;
      }
    },
    current: () => current,
    taken: () => taken,
  };
}

// A build that never answers is worse than one that says which step it was in when it gave up.
export async function withinTheDeadline<Result>(
  steps: StepTimer,
  work: () => Promise<Result>,
): Promise<Result> {
  let ring: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_keep, giveUp) => {
    ring = setTimeout(() => {
      giveUp(new TheBuildTookTooLong(steps.current()));
    }, A_BUILD_HAS_FORTY_SECONDS);
  });
  try {
    return await Promise.race([work(), deadline]);
  } finally {
    clearTimeout(ring);
  }
}
