import RenderGraph from "../rendergraph";
import MediaNode from "./medianode";
import Hls from "hls.js";

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
            preloadTime
        );

        this._duration = duration;
        // setting up the max buffer to match the duration of the clip
        // to avoid preloading to much sections of the video
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

        //Set the source path.
        this._id = id;
        this._src = src;
        this._elementURL = src;
        this._loaded = false;
        this._displayName = TYPE;
        this._elementType = "hls";
    }

    _load() {
        if (!this._loaded) {
            // Create a video element.
            const video = document.createElement("video");
            video.id = this._id;
            video.volume = this._attributes.volume!;
            this._hls.attachMedia(video);
            this._hls.loadSource(this._src);
            this._element = video;

            this._loaded = true;
            this._hlsLoading = true;
            this._hls.startLevel = this._hls.levels.length - 1;
        } else if (!this._hlsLoading) {
            this._hls.loadSource(this._src);
            this._hlsLoading = true;
        }
        super._load();
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
            this._hls.destroy();
        }
        super.destroy();
    }
}

export { TYPE as HLSTYPE };

export default HLSNode;
