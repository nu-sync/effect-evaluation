/**
 * Typed failures for the System One client.
 *
 * The taxonomy follows the documented API responses, and separates the three
 * things a caller actually needs to tell apart: a request that will never
 * succeed as written, a request that is worth retrying, and a response the
 * client could not make sense of.
 *
 * @since 0.1.0
 */
import { Data } from "effect"

/**
 * The request never reached the service, or the connection failed mid-flight.
 *
 * @since 0.1.0
 */
export class TransportError extends Data.TaggedError("SystemOne/TransportError")<{
  readonly cause: unknown
}> {
  override get message(): string {
    return `System One request failed in transport: ${String(this.cause)}`
  }
}

/**
 * The API key is missing, malformed, or rejected (HTTP 401). Terminal.
 *
 * @since 0.1.0
 */
export class AuthError extends Data.TaggedError("SystemOne/AuthError")<{
  readonly body: string
}> {
  readonly status = 401
  override get message(): string {
    return "System One rejected the API key (401)"
  }
}

/**
 * The request was rejected before evaluation (HTTP 422), or failed this
 * client's own pre-flight validation. Terminal: retrying sends the same
 * invalid request again.
 *
 * @since 0.1.0
 */
export class RequestError extends Data.TaggedError("SystemOne/RequestError")<{
  readonly reason: string
  readonly body?: string
}> {
  readonly status = 422
  override get message(): string {
    return `System One rejected the request: ${this.reason}`
  }
}

/**
 * Rate limited (HTTP 429). Transient. `retryAfterSeconds` is populated when the
 * service sends a `retry-after` header.
 *
 * @since 0.1.0
 */
export class RateLimitError extends Data.TaggedError("SystemOne/RateLimitError")<{
  readonly retryAfterSeconds?: number | undefined
  readonly body: string
}> {
  readonly status = 429
  override get message(): string {
    return this.retryAfterSeconds === undefined
      ? "System One rate limit exceeded (429)"
      : `System One rate limit exceeded (429), retry after ${this.retryAfterSeconds}s`
  }
}

/**
 * The service is temporarily overloaded (HTTP 529) or returned a 5xx.
 * Transient.
 *
 * @since 0.1.0
 */
export class OverloadedError extends Data.TaggedError("SystemOne/OverloadedError")<{
  readonly status: number
  readonly body: string
}> {
  override get message(): string {
    return `System One is temporarily unavailable (${this.status})`
  }
}

/**
 * The response was received but could not be decoded into the documented
 * shape, or an answer did not match the type of the question that asked for it.
 *
 * A mismatch is worth surfacing rather than coercing: it means the typed answer
 * map this client promised would be a lie.
 *
 * @since 0.1.0
 */
export class ResponseError extends Data.TaggedError("SystemOne/ResponseError")<{
  readonly reason: string
  readonly cause?: unknown
}> {
  override get message(): string {
    return `System One returned an unusable response: ${this.reason}`
  }
}

/**
 * The request body could not be encoded as JSON — usually a cyclic or
 * non-serializable value passed as `state`.
 *
 * @since 0.1.0
 */
export class EncodeError extends Data.TaggedError("SystemOne/EncodeError")<{
  readonly cause: unknown
}> {
  override get message(): string {
    return `System One request body could not be encoded as JSON: ${String(this.cause)}`
  }
}

/**
 * Every failure `SystemOne.evaluate` can produce.
 *
 * @since 0.1.0
 */
export type SystemOneError =
  | TransportError
  | AuthError
  | RequestError
  | RateLimitError
  | OverloadedError
  | ResponseError
  | EncodeError

/**
 * Whether a failure is worth retrying. Transport blips, rate limits, and
 * overload are; rejected keys, invalid requests, and undecodable responses are
 * not.
 *
 * Exported so callers can build their own retry policy — this client never
 * retries on its own.
 *
 * @since 0.1.0
 */
export const isTransient = (error: SystemOneError): boolean => {
  switch (error._tag) {
    case "SystemOne/TransportError":
    case "SystemOne/RateLimitError":
    case "SystemOne/OverloadedError":
      return true
    default:
      return false
  }
}
