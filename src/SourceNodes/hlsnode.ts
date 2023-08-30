import RenderGraph from "../rendergraph";
import MediaNode from "./medianode";
import Hls from "hls.js";
import { SOURCENODESTATE } from "./sourcenode";

const TYPE = "HLSNode";

const DEFAULT_MAX_BUFFER_LENGTH = 30; // seconds

export class HLSNode extends MediaNode {
    _hls: Hls;
    _src: string;
    _loaded: boolean;
    _hlsLoading: boolean = false;
    _duration: number | undefined;

    constructor(
        id: string,
        src: string,
        gl: WebGLRenderingContext,
        renderGraph: RenderGraph,
        currentTime: number,
        globalPlaybackRate = 1.0,
        sourceOffset: number = 0,
        preloadTime: number = 10,
        duration: number | undefined,
        debug: boolean = false
    ) {
        super(
            undefined, // don't pass the src now, only when _load is called
            gl,
            renderGraph,
            currentTime,
            globalPlaybackRate,
            sourceOffset,
            preloadTime,
            undefined
        );

        this._duration = duration;
        // setting up the max buffer to match the duration of the clip
        // to avoid preloading to much sections of the media
        // when calling _load and improve performance
        const maxBufferLength =
            duration === undefined
                ? DEFAULT_MAX_BUFFER_LENGTH
                : duration < DEFAULT_MAX_BUFFER_LENGTH
                ? duration
                : DEFAULT_MAX_BUFFER_LENGTH;

        //Create a HLS object.
        this._hls = new Hls({
            debug: debug,
            startPosition: sourceOffset,
            maxBufferLength: maxBufferLength,
            maxMaxBufferLength: duration,
            backBufferLength: duration
        });

        // LEVEL_LOADED is fired when a level playlist loading finishes - data: { details : levelDetails object, level : id of loaded level, stats : LoaderStats }
        this._hls.on(Hls.Events.LEVEL_LOADED, () => {
            this._hls.startLevel = this._hls.levels.length - 1;
            this._hls.currentLevel = this._hls.levels.length - 1;
        });

        //Set the source path.
        this._id = id;
        this._src = src;
        this._elementURL = src;
        this._loaded = false;
        this._displayName = TYPE;
    }

    _createElement() {
        // Subclasses of this node will implement this.
        throw new Error("Error - HLSNode does not implement _createElement");
    }

    _load() {
        if (!this._loaded) {
            this._createElement();
            this._hls.attachMedia(this._element!);
            this._hls.loadSource(this._src);

            this._loaded = true;
            this._hlsLoading = true;
        } else if (!this._hlsLoading) {
            this._hls.loadSource(this._src);
            this._hlsLoading = true;
        }
        super._load();
    }

    _isReady() {
        if (this._state === SOURCENODESTATE.sequenced || this._state === SOURCENODESTATE.waiting) {
            return true;
        }
        const isActiveNode =
            this._currentTime <= this._stopTime && this._currentTime >= this._startTime;

        if (isActiveNode) {
            return super._isReady();
        }

        return true;
    }

    _unload() {
        if (this._hlsLoading) {
            this._hls.stopLoad();
            this._hlsLoading = false;
        }
        super._unload();
    }

    destroy() {
        this._unload();
        this._hls.detachMedia();

        this._element?.remove();
        this._element = undefined;
        this._loaded = false;
        this._hlsLoading = false;

        if (this._hls) {
            this._hls.off(Hls.Events.LEVEL_LOADED);
            this._hls.destroy();
        }
        super.destroy();
    }
}

export { TYPE as HLSTYPE };

export default HLSNode;
