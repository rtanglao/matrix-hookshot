import { Intent, StateEvent } from "matrix-bot-sdk";
import markdownit from "markdown-it";
import { FigmaPayload } from "../figma/types";
import { BaseConnection } from "./BaseConnection";
import { IConnection, IConnectionState } from ".";
import LogWrapper from "../LogWrapper";
import { IBridgeStorageProvider } from "../Stores/StorageProvider";
import { BridgeConfigFigma } from "../Config/Config";
import { Connection, InstantiateConnectionOpts, ProvisionConnectionOpts } from "./IConnection";

const log = new LogWrapper("FigmaFileConnection");

export interface FigmaFileConnectionState extends IConnectionState {
    fileId: string;
    instanceName?: string;
}

const THREAD_RELATION_TYPE = "m.thread";

const md = markdownit();
@Connection
export class FigmaFileConnection extends BaseConnection implements IConnection {
    static readonly CanonicalEventType = "uk.half-shot.matrix-hookshot.figma.file";
    static readonly LegacyEventType = "uk.half-shot.matrix-figma.file"; // Magically import from matrix-figma

    static readonly EventTypes = [
        FigmaFileConnection.CanonicalEventType,
        FigmaFileConnection.LegacyEventType,
    ];
    static readonly ServiceCategory = "figma";


    public static validateState(data: Record<string, unknown>): FigmaFileConnectionState {
        if (!data.fileId || typeof data.fileId !== "string") {
            throw Error('Missing or invalid fileId');
        }
        if (data.instanceName && typeof data.instanceName !== "string") {
            throw Error('Invalid instanceName');
        }
        return {
            instanceName: typeof data.instanceName === "string" ? data.instanceName : undefined,
            fileId: data.fileId,
        }
    }

    public static createConnectionForState(roomId: string, event: StateEvent<any>, {config, intent, storage}: InstantiateConnectionOpts) {
        if (!config.figma) {
            throw Error('Figma is not configured');
        }
        return new FigmaFileConnection(roomId, event.stateKey, event.content, config.figma, intent, storage);
    }

    static async provisionConnection(roomId: string, userId: string, data: Record<string, unknown> = {}, {intent, config, storage}: ProvisionConnectionOpts) {
        if (!config.figma) {
            throw Error('Figma is not configured');
        }
        const validState = this.validateState(data);
        const connection = new FigmaFileConnection(roomId, validState.fileId, validState, config.figma, intent, storage);
        await intent.underlyingClient.sendStateEvent(roomId, FigmaFileConnection.CanonicalEventType, validState.fileId, validState);
        return {
            connection,
            stateEventContent: validState,
        }
    }


    constructor(
        roomId: string,
        stateKey: string,
        private state: FigmaFileConnectionState,
        private readonly config: BridgeConfigFigma,
        private readonly intent: Intent,
        private readonly storage: IBridgeStorageProvider) {
        super(roomId, stateKey, FigmaFileConnection.CanonicalEventType)
    }

    public isInterestedInStateEvent() {
        return false; // We don't support state-updates...yet.
    }

    public get fileId() {
        return this.state.fileId;
    }

    public get instanceName() {
        return this.state.instanceName;
    }

    public get priority(): number {
        return this.state.priority || super.priority;
    }

    public async handleNewComment(payload: FigmaPayload) {
        // We need to check if the comment was actually new.
        // There isn't a way to tell how the comment has changed, so for now check the timestamps
        const age = Date.now() - Date.parse(payload.created_at);
        if (age > 5000) {
            // Comment was created at least 5 seconds before the webhook, ignore it.
            log.warn(`Comment ${payload.comment_id} is stale, ignoring (${age}ms old)`);
            return;
        }

        // TODO ???
        // const intent = this.as.getIntentForUserId(this.config.overrideUserId || this.as.botUserId);

        const permalink = `https://www.figma.com/file/${payload.file_key}#${payload.comment_id}`;
        const comment = payload.comment.map(({text}) => text).join("\n");
        const empty = "‎"; // This contains an empty character to thwart the notification matcher.
        const name = payload.triggered_by.handle.split(' ').map(p => p[0] + empty + p.slice(1)).join(' ');
        let content: Record<string, unknown>|undefined = undefined;
        const parentEventId = payload.parent_id && await this.storage.getFigmaCommentEventId(this.roomId, payload.parent_id);
        if (parentEventId) {
            content = {
                "m.relates_to": {
                    rel_type: THREAD_RELATION_TYPE,
                    event_id: parentEventId,
                    // Needed to prevent clients from showing these as actual replies
                    is_falling_back: true,
                    "m.in_reply_to": {
                        event_id: parentEventId,
                    }
                },
                body: `**${name}**: ${comment}`,
                formatted_body: `<strong>${name}</strong>: ${comment}`,
                format: "org.matrix.custom.html",
                msgtype: "m.notice",
                "uk.half-shot.matrix-hookshot.figma.comment_id": payload.comment_id,
            }
        } else {
            // Root event.
            const body = `**${name}** [commented](${permalink}) on [${payload.file_name}](https://www.figma.com/file/${payload.file_key}): ${comment}`;
            content = {
                msgtype: "m.notice",
                body: body,
                formatted_body: md.renderInline(body),
                format: "org.matrix.custom.html",
                "uk.half-shot.matrix-hookshot.figma.comment_id": payload.comment_id,
            };
        }
        content["uk.half-shot.matrix-hookshot.figma.comment_id"] = payload.comment_id;
        const eventId = await this.intent.sendEvent(this.roomId, content);
        log.info(`New figma comment ${payload.comment_id} -> ${this.roomId}/${eventId}`)
        await this.storage.setFigmaCommentEventId(this.roomId, payload.comment_id, eventId);
    }

    public toString() {
        return `FigmaFileConnection ${this.instanceName}/${this.fileId || "*"}`;
    }
}
