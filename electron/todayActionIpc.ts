export type TodayActionIpcEvent = {
    readonly sender: object;
};

export type TodayActionIpcHandlerDependencies<
    TChapterContext,
    TAuthorizationResponse,
    TCommittedStatus,
> = {
    isTrustedSender: (event: TodayActionIpcEvent) => boolean;
    readChapterContext: () => TChapterContext;
    authorizeStaleReview: (request: unknown, trustedSender: object) => TAuthorizationResponse;
    getCommittedStatus: (request: unknown) => TCommittedStatus;
};

function assertTrustedSender(
    event: TodayActionIpcEvent,
    isTrustedSender: (event: TodayActionIpcEvent) => boolean,
): void {
    if (!isTrustedSender(event)) {
        throw new Error('Today Action privileged request rejected');
    }
}

export function createTodayActionIpcHandlers<
    TChapterContext,
    TAuthorizationResponse,
    TCommittedStatus,
>(dependencies: TodayActionIpcHandlerDependencies<
    TChapterContext,
    TAuthorizationResponse,
    TCommittedStatus
>) {
    return {
        getAuthoritativeChapterContext(event: TodayActionIpcEvent): TChapterContext {
            assertTrustedSender(event, dependencies.isTrustedSender);
            return dependencies.readChapterContext();
        },
        authorizeStaleReview(
            event: TodayActionIpcEvent,
            request: unknown,
        ): TAuthorizationResponse {
            assertTrustedSender(event, dependencies.isTrustedSender);
            return dependencies.authorizeStaleReview(request, event.sender);
        },
        getCommittedStatus(
            event: TodayActionIpcEvent,
            request: unknown,
        ): TCommittedStatus {
            assertTrustedSender(event, dependencies.isTrustedSender);
            return dependencies.getCommittedStatus(request);
        },
    };
}
