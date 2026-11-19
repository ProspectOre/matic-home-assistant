// `clock.install` starts the fake clock running from its time, so a
// `pauseAt` at that same time can land in the past on a slow runner.
// Installing a second earlier keeps the pause ahead of the running clock.
export async function pauseClockAt(page, time) {
  await page.clock.install({ time: new Date(time.getTime() - 1_000) });
  await page.clock.pauseAt(time);
}
