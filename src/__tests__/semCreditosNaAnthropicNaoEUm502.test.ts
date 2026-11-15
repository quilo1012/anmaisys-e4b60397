import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  anthropicFailure,
  CREDITS_EXHAUSTED_ERROR,
  isCreditsExhausted,
} from "../../supabase/functions/_shared/anthropicFailure";
import { isDegradedError, shouldRetry } from "@/lib/backendHealth";

/**
 * Conta da Anthropic sem créditos não é uma avaria do gateway.
 *
 * A 15/11/2026, das 07:05 às 08:30, a `translate-message` respondeu seis vezes 502
 * `AI error: {...credit balance is too low...}` a um engenheiro em /dashboard/engineer.
 * A Anthropic não responde a isso com 401 nem com 402: responde **400
 * `invalid_request_error`**, e a razão vem só na frase. As três funções de IA só
 * conheciam o 429 e o 401/403, por isso a conta vazia caía no ramo genérico — um 502,
 * que o Root Diagnostics pôs ao lado de dois bloqueios reais da base, e que o
 * `backendHealth` conta como a base a engasgar-se.
 *
 * O corpo abaixo é o que a produção registou, palavra por palavra.
 */

const OBSERVED_15_11 =
  '{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."},"request_id":"req_011Ch4Hji7PbCk5srq6ctXya"}';

const MESSAGES = { rateLimited: "rate", keyRejected: "key" };

describe("anthropicFailure", () => {
  it("lê a conta vazia na forma em que chegou a 15/11", () => {
    const f = anthropicFailure(400, OBSERVED_15_11, MESSAGES);
    expect(f.status).toBe(402);
    expect(f.code).toBe("ai_credits_exhausted");
    expect(f.error).toBe(CREDITS_EXHAUSTED_ERROR);
    // O que o admin lê no Root Diagnostics diz o que fazer, e não o corpo cru.
    expect(f.error).toMatch(/Plans & Billing/);
    expect(f.error).not.toMatch(/request_id/);
  });

  it("lê também as formas documentadas: 402 e billing_error", () => {
    expect(isCreditsExhausted(402, "")).toBe(true);
    expect(isCreditsExhausted(400, '{"type":"error","error":{"type":"billing_error","message":"x"}}')).toBe(true);
  });

  it("não confunde um pedido mal feito com falta de créditos", () => {
    const body = '{"type":"error","error":{"type":"invalid_request_error","message":"max_tokens: field required"}}';
    expect(isCreditsExhausted(400, body)).toBe(false);
    const f = anthropicFailure(400, body, MESSAGES);
    expect(f.status).toBe(502);
    expect(f.code).toBe("ai_error");
  });

  it("deixa o 429 e a chave recusada como estavam", () => {
    expect(anthropicFailure(429, "{}", MESSAGES)).toEqual({ status: 429, code: "ai_rate_limited", error: "rate" });
    expect(anthropicFailure(401, "{}", MESSAGES)).toEqual({ status: 502, code: "ai_key_rejected", error: "key" });
    expect(anthropicFailure(403, "{}", MESSAGES)).toEqual({ status: 502, code: "ai_key_rejected", error: "key" });
  });

  it("não é retentado nem conta como a base a engasgar-se", () => {
    const f = anthropicFailure(400, OBSERVED_15_11, MESSAGES);
    const asTheClientSeesIt = { message: f.error, status: f.status, context: { status: f.status } };
    expect(isDegradedError(asTheClientSeesIt)).toBe(false);
    expect(shouldRetry(0, asTheClientSeesIt)).toBe(false);
  });
});

describe("as três funções que falam com a Anthropic", () => {
  const FUNCTIONS = ["translate-message", "identify-part", "analyze-sku-performance"];

  it.each(FUNCTIONS)("%s responde às recusas pelo anthropicFailure, sem ramo próprio", (name) => {
    const src = readFileSync(resolve(__dirname, "../../supabase/functions", name, "index.ts"), "utf8");
    expect(src).toMatch(/from "\.\.\/_shared\/anthropicFailure\.ts"/);
    expect(src).toMatch(/anthropicFailure\(resp\.status, await resp\.text\(\)/);
    // O ramo antigo devolvia o corpo cru com 502 para tudo o que não fosse 429/401/403.
    expect(src).not.toMatch(/`AI error: \$\{txt/);
  });
});
