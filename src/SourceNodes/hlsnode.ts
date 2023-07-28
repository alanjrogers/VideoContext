import RenderGraph from "../rendergraph";
import VideoNode from "./videonode";
import Hls from "hls.js";

const TYPE = "HLSNode";

class HLSNode extends VideoNode {
    private hls: Hls;
    private src: string;
    private loaded: boolean;

    /*
    constructor(
            src: any,
            gl: WebGLRenderingContext,
            renderGraph: RenderGraph,
            currentTime: number,
            globalPlaybackRate = 1.0,
            sourceOffset = 0,
            preloadTime = 4,
            mediaElementCache = undefined as VideoElementCache | undefined,
            attributes = {}
        ) {
    */

    constructor(
        src: string,
        gl: WebGLRenderingContext,
        renderGraph: RenderGraph,
        currentTime: number,
        globalPlaybackRate = 1.0,
        sourceOffset: number = 0,
        preloadTime: number = 10,
        maxBufferLength: number = 30
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

        //Create a HLS object.
        this.hls = new Hls({
            debug: false, // set to true to see HLS logging
            startPosition: sourceOffset,
            maxBufferLength: maxBufferLength
        });

        //Set the source path.
        this.src = src;
        this.loaded = false;
        this._displayName = TYPE;
        this._elementType = "hls";
    }

    _load() {
        if (!this.loaded) {
            console.debug(`_load() called for src:${String(this.src)}`);
            //Create a video element.
            const video = document.createElement("video");
            this.hls.attachMedia(video);
            this.hls.loadSource(this.src);
            this._element = video;
            this.loaded = true;
            this.hls.startLevel = this.hls.levels.length - 1;
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
