export declare const POLLER_INTERVAL_IN_MS: number;
export declare class SessionCookiePoller {
    private lock;
    private workerTimers;
    private timerId;
    private initiated;
    startPollingForSessionToken(cb: () => Promise<unknown>): void;
    stopPollingForSessionToken(): void;
}
