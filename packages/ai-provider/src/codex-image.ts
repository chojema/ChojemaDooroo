/**
 * Image generation through the Codex subscription. Entry point
 * `@genoffice/ai-provider/codex-image`.
 *
 * Intentionally absent in this stage: a launch that never touches the Codex
 * login file (`codex exec`, user configuration ignored, prompt on stdin) signs
 * in and runs, but it could not be shown to produce an image, because Codex
 * offers its image tool to no model of the account it was probed with (ChatGPT
 * plan `free`). Nothing here declares the feature available, so
 * codexImageGenerationAvailable() stays false and no generator is registered.
 */
export {}
