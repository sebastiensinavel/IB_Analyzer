/**
 * The last step of `main.tsx`, apart so it can be tested: a preparation step (the demo's seed,
 * sub-project 41) runs before the first render, and its failure never keeps the application
 * from mounting — a blank page would say nothing, the application at least shows what it has.
 */
export async function startApp(prepare: () => Promise<void>, render: () => void): Promise<void> {
  try {
    await prepare();
  } catch (e) {
    console.error("Startup preparation failed; rendering anyway.", e);
  }
  render();
}
