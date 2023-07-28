import RenderGraph from "../rendergraph";
import MediaNode from "./medianode";
import Hls from "hls.js";

const TYPE = "HLSNode";

// TODO(danareyes): when playing the video the load
// of the node adds a lag, less buffer time seems to
// imporve that we should figure out why
const DEFAULT_MAX_BUFFER_LENGTH = 30; // seconds

class HLSNode extends MediaNode {
    private hls: Hls;
    private src: string;
    private loaded: boolean;
    private _id: string;
    private _duration: number | undefined;
    private _hlsLoading: boolean = false;

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
        debug: boolean = false,
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

        // seting up the max buffer to match the duration of the clip
        // to avoid preloading to much sections of the video
        // when calling _load and improve performance
        const maxBufferLength = duration === undefined ? DEFAULT_MAX_BUFFER_LENGTH :
            duration < DEFAULT_MAX_BUFFER_LENGTH
                ? duration
                : DEFAULT_MAX_BUFFER_LENGTH;

        this._duration = duration;

        //Create a HLS object.
        this.hls = new Hls({
            debug: debug,
            startPosition: sourceOffset,
            maxBufferLength: maxBufferLength,
            maxMaxBufferLength: duration,
            backBufferLength: duration,
        });

        this.hls.on(Hls.Events.BUFFER_APPENDED, () => {
            if (this._element && this._element.buffered.length > 0 && duration !== undefined) {
                const start = this._element.buffered.start(0);
                const end = this._element.buffered.end(0);
                console.debug(`clipId ${this._id}: ${start} - ${end}`);

                if (start <= sourceOffset && end >= (sourceOffset + duration)) {
                    this.hls.stopLoad();
                    this._hlsLoading = false;
                }
            }
        });

        this.hls.on(Hls.Events.BUFFER_EOS, () => {
            console.debug(`clipId ${this._id}: BUFFER_EOS loading`);
            if (!this._hlsLoading) {
                this.hls.startLoad(sourceOffset);
                this._hlsLoading = true;
            }
        });

        this.hls.on(Hls.Events.BUFFER_FLUSHED, () => {
            if (!this._hlsLoading) {
                console.debug(`clipId ${this._id}: BUFFER_FLUSHED loading`);
                this.hls.startLoad(sourceOffset);
                this._hlsLoading = true;
            }
        });

        this.hls.on(Hls.Events.BUFFER_RESET, () => {
            if (!this._hlsLoading) {
                console.debug(`clipId ${this._id}: BUFFER_RESET loading`);
                this.hls.startLoad(sourceOffset);
                this._hlsLoading = true;
            }
        });

        if (debug) {
            console.debug(`clipId: ${id} startOffset: ${sourceOffset}, duration: ${duration}, maxBufferLength: ${maxBufferLength}`);
        }

        //Set the source path.
        this._id = id;
        this.src = src;
        this.loaded = false;
        this._displayName = TYPE;
        this._elementType = "hls";
    }

    _load() {
        if (!this.loaded) {
            //Create a video element.
            const video = document.createElement("video");
            this.hls.attachMedia(video);
            this.hls.loadSource(this.src);
            this._element = video;

            this.loaded = true;
            this._hlsLoading = true;
            this.hls.startLevel = this.hls.levels.length - 1;

            // add this for debugging video elements
            let container = document.getElementById("video-debug-container");
            if (!container) {
                container = document.createElement("div");
                container.id = "video-debug-container";
                container.style.position = "absolute";
                container.style.top = "0";
                container.style.backgroundColor = "rgba(0,0,0,0.5)";
                document.body.append(container);
            }
            video.width = 100;
            container.appendChild(video);
        }
        super._load();
    }

    _unload() {
        // TODO(danareyes): add unload logic here similar to what videocontext is doing internally
        // create a video element cache where video elements can be reuse so we don't create one element per node
        // we can have lets say 5 video html elements and reuse them.
        super._unload();
    }

    destroy() {
        if (this.hls) {
            this.hls.destroy();
        }
        super.destroy();
    }
}

export { TYPE as HLSTYPE };

export default HLSNode;
