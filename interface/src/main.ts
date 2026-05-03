/**
 * Entry point for the chat app.
 *
 * Imports register the A2UI Lit components (stock + our custom QuizCard
 * via theme-provider) before chat.ts boots its SSE loop and starts
 * mounting agent replies.
 */

import "@a2ui/lit/ui";
import "./theme-provider.js";
import "./chat.js";
