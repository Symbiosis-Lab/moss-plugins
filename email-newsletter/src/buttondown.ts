/**
 * Buttondown API client
 *
 * Handles communication with Buttondown's REST API for sending newsletter emails.
 */

import { httpPost } from "@symbiosis-lab/moss-api";
import type { ButtondownEmailResponse } from "./types";

const BUTTONDOWN_API_URL = "https://api.buttondown.com/v1/emails";

/**
 * Create an email via Buttondown API
 *
 * @param apiKey - Buttondown API key
 * @param subject - Email subject line
 * @param body - Email content (Markdown supported)
 * @param asDraft - If true, create as draft; otherwise send immediately
 * @returns The created email response
 */
export async function createEmail(
  apiKey: string,
  subject: string,
  body: string,
  asDraft: boolean = true
): Promise<ButtondownEmailResponse> {
  const status = asDraft ? "draft" : "sent";

  const result = await httpPost(
    BUTTONDOWN_API_URL,
    {
      subject,
      body,
      status,
    },
    {
      headers: {
        Authorization: `Token ${apiKey}`,
      },
    }
  );

  if (!result.ok) {
    const errorText = result.text();
    throw new Error(`Buttondown API error (${result.status}): ${errorText}`);
  }

  const response = JSON.parse(result.text()) as ButtondownEmailResponse;
  return response;
}

/**
 * Validate API key by attempting to list emails (HEAD request would be better but httpPost is what we have)
 *
 * @param apiKey - Buttondown API key to validate
 * @returns True if the API key is valid
 */
export async function validateApiKey(apiKey: string): Promise<boolean> {
  try {
    // Try to fetch emails list - this will fail if API key is invalid
    const result = await httpPost(
      BUTTONDOWN_API_URL,
      {
        subject: "API Key Test",
        body: "Test",
        status: "draft",
      },
      {
        headers: {
          Authorization: `Token ${apiKey}`,
        },
      }
    );

    // If we get a 401, the API key is invalid
    // If we get a 2xx, the API key is valid (we created a draft, which is fine)
    return result.ok;
  } catch {
    return false;
  }
}
