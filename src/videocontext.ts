//Matthew Shotton, R&D User Experience,© BBC 2015
import {
    createSigmaGraphDataFromRenderGraph,
    visualiseVideoContextTimeline,
    visualiseVideoContextGraph,
    createControlFormForNode,
    UpdateablesManager,
    exportToJSON,
    importSimpleEDL,
    snapshot,
    generateRandomId
} from "./utils";
import NODES from "./SourceNodes/nodes";
import VideoNode from "./SourceNodes/videonode";
import AudioNode from "./SourceNodes/audionode";
import ImageNode from "./SourceNodes/imagenode";
import CanvasNode from "./SourceNodes/canvasnode";
import SourceNode, { SOURCENODESTATE } from "./SourceNodes/sourcenode";
import CompositingNode from "./ProcessingNodes/compositingnode";
import DestinationNode from "./DestinationNode/destinationnode";
import EffectNode from "./ProcessingNodes/effectnode";
import TransitionNode from "./ProcessingNodes/transitionnode";
import RenderGraph from "./rendergraph";
import VideoElementCache from "./videoelementcache";
import DEFINITIONS, { IDefinition } from "./Definitions/definitions";
import ProcessingNode from "./ProcessingNodes/processingnode";
import GraphNode from "./graphnode";
import MediaNode from "./SourceNodes/medianode";
import HLSNode from "./SourceNodes/hlsnode";
import HLSVideoNode from "./SourceNodes/hlsvideonode";
import HLSAudioNode from "./SourceNodes/hlsaudionode";

// Extra exports for debugging
export { SourceNode } from "./SourceNodes/sourcenode";
export { HLSVideoNode } from "./SourceNodes/hlsvideonode";
export { HLSAudioNode } from "./SourceNodes/hlsaudionode";
export * from "./utils";

let updateablesManager = new UpdateablesManager();

interface TimelineCallback {
    time: number;
    func: Function;
    ordering: number;
}

/**
 * VideoContext.
 * @module VideoContext
 */
export default class VideoContext {
    /**
     * Video Context States
     * @readonly
     * @typedef {Object} STATE
     * @property {number} STATE.PLAYING - All sources are active
     * @property {number} STATE.PAUSED - All sources are paused
     * @property {number} STATE.SEEKING - VideoContext is currently seeking to a new currentTime.
     * @property {number} STATE.STALLED - One or more sources is unable to play
     * @property {number} STATE.ENDED - All sources have finished playing
     * @property {number} STATE.BROKEN - The render graph is in a broken state
     */
    static STATE = Object.freeze({
        PLAYING: 0,
        PAUSED: 1,
        STALLED: 2,
        ENDED: 3,
        BROKEN: 4,
        SEEKING: 5
    });

    /**
     * Video Context Events
     * @readonly
     * @typedef {Object} EVENTS
     * @property {string} EVENTS.UPDATE - Called any time a frame is rendered to the screen.
     * @property {string} EVENTS.SEEKING - Called any time the VideoContext starts seeking to a new time.
     * @property {string} EVENTS.SEEKED - Called any time the VideoContext has finished (frame has rendered) seeking to a new time .
     * @property {string} EVENTS.PLAY - Called any time the VideoContext has been requested to play.
     * @property {string} EVENTS.PLAYING - Called any time the VideoContext has started playing (state = PLAYING)
     * @property {string} EVENTS.PAUSE - Called any time the VideoContext has been requested to pause.
     * @property {string} EVENTS.PAUSED - Called any time the VideoContext has gone into the PAUSED state.
     * @property {string} EVENTS.STALLED - happens anytime the playback is stopped due to buffer starvation for playing assets.
     * @property {string} EVENTS.ENDED - Called once plackback has finished (i.e ctx.currentTime == ctx.duration).
     * @property {string} EVENTS.CONTENT - Called at the start of a time region where there is content playing out of one or more sourceNodes.
     * @property {number} EVENTS.NOCONTENT - Called at the start of any time region where the VideoContext is still playing, but there are currently no active playing sources.
     */
    static EVENTS = Object.freeze({
        UPDATE: "update",
        SEEKING: "seeking",
        SEEKED: "seeked",
        PLAY: "play",
        PLAYING: "playing",
        PAUSE: "pause",
        PAUSED: "paused",
        STALLED: "stalled",
        ENDED: "ended",
        CONTENT: "content",
        NOCONTENT: "nocontent"
    });

    static visualiseVideoContextTimeline = visualiseVideoContextTimeline;
    static visualiseVideoContextGraph = visualiseVideoContextGraph;
    static createControlFormForNode = createControlFormForNode;
    static createSigmaGraphDataFromRenderGraph = createSigmaGraphDataFromRenderGraph;
    static exportToJSON = exportToJSON;
    static updateablesManager = updateablesManager;
    static importSimpleEDL = importSimpleEDL;

    _canvas: HTMLCanvasElement;
    _endOnLastSourceEnd: boolean;
    _gl: WebGL2RenderingContext;
    _useVideoElementCache!: boolean;
    _videoElementCache!: VideoElementCache;
    _id!: string;
    _renderGraph!: RenderGraph;
    _sourceNodes!: SourceNode[];
    _processingNodes!: ProcessingNode[];
    _timeline!: never[];
    _currentTime!: number;
    _state!: number;
    _playbackRate!: number;
    _volume!: number;
    _sourcesPlaying: boolean | undefined;
    _destinationNode!: DestinationNode;
    _callbacks!: Map<string, Function[]>;
    _timelineCallbacks!: Array<TimelineCallback>;
    _renderNodeOnDemandOnly: boolean;
    _lastRenderTime: number | undefined;
    _runAfterNextRender: (() => boolean) | undefined;
    /**
     * Initialise the VideoContext and render to the specific canvas. A 2nd parameter can be passed to the constructor which is a function that get's called if the VideoContext fails to initialise.
     *
     * @param {Canvas} canvas - the canvas element to render the output to.
     * @param {function} [initErrorCallback] - a callback for if initialising the canvas failed.
     * @param {Object} [options] - a number of custom options which can be set on the VideoContext, generally best left as default.
     * @param {boolean} [options.manualUpdate=false] - Make Video Context not use the updatable manager
     * @param {boolean} [options.endOnLastSourceEnd=true] - Trigger an `ended` event when the current time goes above the duration of the composition
     * @param {boolean} [options.useVideoElementCache=true] - Creates a pool of video element that will be all initialised at the same time. Important for mobile support
     * @param {number} [options.videoElementCacheSize=6] - Number of video element in the pool
     * @param {object} [options.webglContextAttributes] - A set of attributes used when getting the GL context. Alpha will always be `true`.
     * @param {boolean} [options.renderNodeOnDemandOnly=false] - Only render if a node needsRender flag is true to improve performance.
     *
     * @example
     * var canvasElement = document.getElementById("canvas");
     * var ctx = new VideoContext(canvasElement, () => console.error("Sorry, your browser dosen\'t support WebGL"));
     * var videoNode = ctx.video("video.mp4");
     * videoNode.connect(ctx.destination);
     * videoNode.start(0);
     * videoNode.stop(10);
     * ctx.play();
     *
     */
    constructor(
        canvas: HTMLCanvasElement,
        initErrorCallback: Function | undefined,
        {
            manualUpdate = false,
            endOnLastSourceEnd = true,
            useVideoElementCache = true,
            videoElementCacheSize = 6,
            webglContextAttributes = {},
            renderNodeOnDemandOnly = false
        } = {}
    ) {
        this._canvas = canvas;
        this._endOnLastSourceEnd = endOnLastSourceEnd;
        this._renderNodeOnDemandOnly = renderNodeOnDemandOnly;

        this._gl = canvas.getContext(
            "webgl2",
            Object.assign(
                { preserveDrawingBuffer: true }, // can be overriden
                webglContextAttributes,
                { alpha: true } // Can't be overriden because it is copied last
            )
        ) as WebGL2RenderingContext;
        if (this._gl === null) {
            console.error("Failed to intialise WebGL.");
            if (initErrorCallback) initErrorCallback();
            return;
        }

        // Initialise the video element cache
        this._useVideoElementCache = useVideoElementCache;
        if (this._useVideoElementCache) {
            this._videoElementCache = new VideoElementCache(videoElementCacheSize);
        }

        // Create a unique ID for this VideoContext which can be used in the debugger.
        if (this._canvas.id) {
            if (typeof this._canvas.id === "string" || (this._canvas.id as any) instanceof String) {
                this._id = canvas.id;
            }
        }
        if (this._id === undefined) this._id = generateRandomId();
        if (window.__VIDEOCONTEXT_REFS__ === undefined) window.__VIDEOCONTEXT_REFS__ = {};
        window.__VIDEOCONTEXT_REFS__[this._id] = this;

        this._renderGraph = new RenderGraph();
        this._sourceNodes = [];
        this._processingNodes = [];
        this._timeline = [];
        this._state = VideoContext.STATE.PAUSED;
        this._currentTime = 0;
        this._playbackRate = 1.0;
        this._volume = 1.0;
        this._sourcesPlaying = undefined;
        this._destinationNode = new DestinationNode(this._gl, this._renderGraph);
        this._lastRenderTime = undefined;
        this._runAfterNextRender = undefined;

        this._callbacks = new Map();
        Object.keys(VideoContext.EVENTS).forEach((name) =>
            this._callbacks.set(VideoContext.EVENTS[name as keyof typeof VideoContext.EVENTS], [])
        );

        this._timelineCallbacks = [];

        if (!manualUpdate) {
            updateablesManager.register(this);
        }
    }

    /**
     * Returns an ID assigned to the VideoContext instance. This will either be the same id as the underlying canvas element,
     * or a uniquely generated one.
     */
    get id() {
        return this._id;
    }

    /**
     * Set the ID of the VideoContext instance. This should be unique.
     */
    set id(newID) {
        delete window.__VIDEOCONTEXT_REFS__?.[this._id];
        if (window.__VIDEOCONTEXT_REFS__?.[newID] !== undefined)
            console.warn("Warning; setting id to that of an existing VideoContext instance.");
        window.__VIDEOCONTEXT_REFS__![newID] = this;
        this._id = newID;
    }

    /**
     * Register a callback to happen at a specific point in time.
     * @param {number} time - the time at which to trigger the callback.
     * @param {Function} func - the callback to register.
     * @param {number} ordering - the order in which to call the callback if more than one is registered for the same time.
     */
    registerTimelineCallback(time: number, func: Function, ordering = 0) {
        this._timelineCallbacks.push({
            time: time,
            func: func,
            ordering: ordering
        });
    }

    /**
     * Unregister a callback which happens at a specific point in time.
     * @param {Function} func - the callback to unregister.
     */
    unregisterTimelineCallback(func: Function) {
        let toRemove = [];
        for (let callback of this._timelineCallbacks) {
            if (callback.func === func) {
                toRemove.push(callback);
            }
        }
        for (let callback of toRemove) {
            let index = this._timelineCallbacks.indexOf(callback);
            this._timelineCallbacks.splice(index, 1);
        }
    }

    /**
     * Register a callback to listen to one of the events defined in `VideoContext.EVENTS`
     *
     * @param {String} type - the event to register against.
     * @param {Function} func - the callback to register.
     *
     * @example
     * var canvasElement = document.getElementById("canvas");
     * var ctx = new VideoContext(canvasElement);
     * ctx.registerCallback(VideoContext.EVENTS.STALLED, () => console.log("Playback stalled"));
     * ctx.registerCallback(VideoContext.EVENTS.UPDATE, () => console.log("new frame"));
     * ctx.registerCallback(VideoContext.EVENTS.ENDED, () => console.log("Playback ended"));
     */
    registerCallback(type: string, func: Function) {
        if (!this._callbacks.has(type)) return false;
        this._callbacks.get(type)!.push(func);
    }

    /**
     * Remove a previously registered callback
     *
     * @param {Function} func - the callback to remove.
     *
     * @example
     * var canvasElement = document.getElementById("canvas");
     * var ctx = new VideoContext(canvasElement);
     *
     * //the callback
     * var updateCallback = () => console.log("new frame");
     *
     * //register the callback
     * ctx.registerCallback(VideoContext.EVENTS.UPDATE, updateCallback);
     * //then unregister it
     * ctx.unregisterCallback(updateCallback);
     *
     */
    unregisterCallback(func: Function) {
        for (let funcArray of this._callbacks.values()) {
            let index = funcArray.indexOf(func);
            if (index !== -1) {
                funcArray.splice(index, 1);
                return true;
            }
        }
        return false;
    }

    _callCallbacks(type: string) {
        let funcArray = this._callbacks.get(type);
        for (let func of funcArray!) {
            func(this._currentTime);
        }
    }

    /**
     * Get the canvas that the VideoContext is using.
     *
     * @return {HTMLCanvasElement} The canvas that the VideoContext is using.
     *
     */
    get element() {
        return this._canvas;
    }

    /**
     * Get the current state.
     * @return {STATE} The number representing the state.
     *
     */
    get state() {
        return this._state;
    }

    /**
     * Set the progress through the internal timeline.
     * Setting this can be used as a way to implement a scrubbable timeline.
     *
     * @param {number} currentTime - this is the currentTime to set in seconds.
     *
     * @example
     * var canvasElement = document.getElementById("canvas");
     * var ctx = new VideoContext(canvasElement);
     * var videoNode = ctx.video("video.mp4");
     * videoNode.connect(ctx.destination);
     * videoNode.start(0);
     * videoNode.stop(20);
     * ctx.currentTime = 10; // seek 10 seconds in
     * ctx.play();
     *
     */
    set currentTime(currentTime) {
        if (this._state === VideoContext.STATE.PAUSED) {
            this._state = VideoContext.STATE.SEEKING;
            this._callCallbacks(VideoContext.EVENTS.SEEKING);
        }

        if (typeof currentTime === "string") {
            currentTime = parseFloat(currentTime);
        }

        for (let i = 0; i < this._sourceNodes.length; i++) {
            this._sourceNodes[i]._seek(currentTime);
        }
        for (let i = 0; i < this._processingNodes.length; i++) {
            this._processingNodes[i]._seek(currentTime);
        }
        this._currentTime = currentTime;

        if (currentTime < this.duration && this._state === VideoContext.STATE.ENDED)
            this._state = VideoContext.STATE.PAUSED;
    }

    /**
     * Get how far through the internal timeline has been played.
     *
     * Getting this value will give the current playhead position. Can be used for updating timelines.
     * @return {number} The time in seconds through the current playlist.
     *
     * @example
     * var canvasElement = document.getElementById("canvas");
     * var ctx = new VideoContext(canvasElement);
     * var videoNode = ctx.video("video.mp4");
     * videoNode.connect(ctx.destination);
     * videoNode.start(0);
     * videoNode.stop(10);
     * ctx.play();
     * setTimeout(() => console.log(ctx.currentTime),1000); //should print roughly 1.0
     *
     */
    get currentTime() {
        return this._currentTime;
    }

    /**
     * Get the time at which the last node in the current internal timeline finishes playing.
     *
     * @return {number} The end time in seconds of the last video node to finish playing.
     *
     * @example
     * var canvasElement = document.getElementById("canvas");
     * var ctx = new VideoContext(canvasElement);
     * console.log(ctx.duration); //prints 0
     *
     * var videoNode = ctx.video("video.mp4");
     * videoNode.connect(ctx.destination);
     * videoNode.start(0);
     * videoNode.stop(10);
     *
     * console.log(ctx.duration); //prints 10
     *
     * ctx.play();
     */
    get duration() {
        let maxTime = 0;
        for (let i = 0; i < this._sourceNodes.length; i++) {
            if (
                this._sourceNodes[i].state !== SOURCENODESTATE.waiting &&
                this._sourceNodes[i]._stopTime > maxTime
            ) {
                maxTime = this._sourceNodes[i]._stopTime;
            }
        }
        return maxTime;
    }

    /**
     * Get the final node in the render graph which represents the canvas to display content on to.
     *
     * This proprety is read-only and there can only ever be one destination node. Other nodes can connect to this but you cannot connect this node to anything.
     *
     * @return {DestinationNode} A graph node representing the canvas to display the content on.
     * @example
     * var canvasElement = document.getElementById("canvas");
     * var ctx = new VideoContext(canvasElement);
     * var videoNode = ctx.video("video.mp4");
     * videoNode.start(0);
     * videoNode.stop(10);
     * videoNode.connect(ctx.destination);
     *
     */
    get destination() {
        return this._destinationNode;
    }

    /**
     * Set the playback rate of the VideoContext instance.
     * This will alter the playback speed of all media elements played through the VideoContext.
     *
     * @param {number} rate - this is the playback rate.
     *
     * @example
     * var canvasElement = document.getElementById("canvas");
     * var ctx = new VideoContext(canvasElement);
     * var videoNode = ctx.video("video.mp4");
     * videoNode.start(0);
     * videoNode.stop(10);
     * videoNode.connect(ctx.destination);
     * ctx.playbackRate = 2;
     * ctx.play(); // Double playback rate means this will finish playing in 5 seconds.
     */
    set playbackRate(rate) {
        if (rate <= 0) {
            throw new RangeError("playbackRate must be greater than 0");
        }
        for (let node of this._sourceNodes) {
            if (node instanceof MediaNode) {
                (node as MediaNode)._globalPlaybackRate = rate;
                (node as MediaNode)._playbackRateUpdated = true;
            }
        }
        this._playbackRate = rate;
    }

    /**
     *  Return the current playbackRate of the video context.
     * @return {number} A value representing the playbackRate. 1.0 by default.
     */
    get playbackRate() {
        return this._playbackRate;
    }

    /**
     * Set the volume of all MediaNode created in the VideoContext.
     * @param {number} volume - the volume to apply to the video nodes.
     */
    set volume(vol) {
        for (let node of this._sourceNodes) {
            if (node instanceof MediaNode) {
                node.volume = vol;
            }
        }
        this._volume = vol;
    }

    /**
     * Return the current volume of the video context.
     * @return {number} A value representing the volume. 1.0 by default.
     */
    get volume() {
        return this._volume;
    }

    /**
     * Start the VideoContext playing
     * @example
     * var canvasElement = document.getElementById("canvas");
     * var ctx = new VideoContext(canvasElement);
     * var videoNode = ctx.video("video.mp4");
     * videoNode.connect(ctx.destination);
     * videoNode.start(0);
     * videoNode.stop(10);
     * ctx.play();
     */
    play() {
        if (this._state === VideoContext.STATE.PLAYING) return false;

        this._callCallbacks(VideoContext.EVENTS.PLAY);

        //Initialise the video element cache
        if (this._videoElementCache) this._videoElementCache.init();
        // set the state.
        this._state = VideoContext.STATE.PLAYING;

        this._runAfterNextRender = () => {
            if (this._state === VideoContext.STATE.PLAYING) {
                this._callCallbacks(VideoContext.EVENTS.PLAYING);
                return true;
            }
            return false;
        };

        return true;
    }

    /**
     * Pause playback of the VideoContext
     * @example
     * var canvasElement = document.getElementById("canvas");
     * var ctx = new VideoContext(canvasElement);
     * var videoNode = ctx.video("video.mp4");
     * videoNode.connect(ctx.destination);
     * videoNode.start(0);
     * videoNode.stop(20);
     * ctx.currentTime = 10; // seek 10 seconds in
     * ctx.play();
     * setTimeout(() => ctx.pause(), 1000); //pause playback after roughly one second.
     */
    pause() {
        if (this._state === VideoContext.STATE.PAUSED || this._state === VideoContext.STATE.SEEKING)
            return false;

        this._callCallbacks(VideoContext.EVENTS.PAUSE);
        this._state = VideoContext.STATE.PAUSED;

        this._runAfterNextRender = () => {
            if (this._state === VideoContext.STATE.PAUSED) {
                this._callCallbacks(VideoContext.EVENTS.PAUSED);
                return true;
            }
            return false;
        };

        return true;
    }

    clearCanvas() {
        this._gl.clear(this._gl.COLOR_BUFFER_BIT);
    }

    /**
     * Create a new node representing a video source
     *
     * @param {string|HTMLVideoElement|MediaStream} - The URL or video element to create the video from.
     * @param {number} [sourceOffset=0] - Offset into the start of the source video to start playing from.
     * @param {number} [preloadTime=4] - How many seconds before the video is to be played to start loading it.
     * @param {Object} [videoElementAttributes] - A dictionary of attributes to map onto the underlying video element.
     * @return {VideoNode} A new video node.
     *
     * @example
     * var canvasElement = document.getElementById("canvas");
     * var ctx = new VideoContext(canvasElement);
     * var videoNode = ctx.video("bigbuckbunny.mp4");
     */
    video(
        src: string | HTMLVideoElement | MediaStream,
        sourceOffset = 0,
        preloadTime = 4,
        videoElementAttributes = {}
    ) {
        let videoNode = new VideoNode(
            src,
            this._gl,
            this._renderGraph,
            this._currentTime,
            this._playbackRate,
            sourceOffset,
            preloadTime,
            this._videoElementCache,
            videoElementAttributes
        );
        this._sourceNodes.push(videoNode);
        return videoNode;
    }

    /**
     * Create a new node representing a HLS video source
     *
     * @param {string} [id] - The id of the node used mostly for debugging.
     * @param {string} [src] - The hls stream URL to create the video from.
     * @param {number} [duration=undefiend] - The duration of the hls srouce (may be less than the actual video length)
     *                              the node will prevent loading beyond this time. If undefined it will not be limited.
     * @param {number} [sourceOffset=0] - Offset into the start of the source video to start playing from.
     * @param {number} [preloadTime=4] - How many seconds before the video is to be played to start loading it.
     * @return {HLSNode} A new HLSNode.
     *
     * @example
     * var canvasElement = document.getElementById("canvas");
     * var ctx = new VideoContext(canvasElement);
     * var videoNode = ctx.hlsVideo("test", "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8");
     */
    hlsVideo(
        id: string,
        src: string,
        duration?: number,
        sourceOffset: number = 0,
        preloadTime: number = 4,
        debug: boolean = false
    ): HLSNode {
        const hlsNode = new HLSVideoNode(
            id,
            src,
            this._gl,
            this._renderGraph,
            this._currentTime,
            this._playbackRate,
            sourceOffset,
            preloadTime,
            duration,
            debug
        );
        hlsNode.volume = this._volume;
        this._sourceNodes.push(hlsNode);
        return hlsNode;
    }

    /**
     * Create a new node representing a HLS audio source
     *
     * @param {string} [id] - The id of the node used mostly for debugging.
     * @param {string} [src] - The hls stream URL to create the video from.
     * @param {number} [duration=undefiend] - The duration of the hls srouce (may be less than the actual audio length)
     *                              the node will prevent loading beyond this time. If undefined it will not be limited.
     * @param {number} [sourceOffset=0] - Offset into the start of the source audio to start playing from.
     * @param {number} [preloadTime=4] - How many seconds before the video is to be played to start loading it.
     * @return {HLSNode} A new HLSNode.
     *
     * @example
     * var canvasElement = document.getElementById("canvas");
     * var ctx = new VideoContext(canvasElement);
     * var videoNode = ctx.hlsAudio("test", "https://pl.streamingvideoprovider.com/mp3-playlist/playlist.m3u8");
     */
    hlsAudio(
        id: string,
        src: string,
        duration?: number,
        sourceOffset: number = 0,
        preloadTime: number = 4,
        debug: boolean = false
    ): HLSNode {
        const hlsNode = new HLSAudioNode(
            id,
            src,
            this._gl,
            this._renderGraph,
            this._currentTime,
            this._playbackRate,
            sourceOffset,
            preloadTime,
            duration,
            debug
        );
        hlsNode.volume = this._volume;
        this._sourceNodes.push(hlsNode);
        return hlsNode;
    }

    /**
     * Create a new node representing an audio source
     * @param {string|HTMLAudioElement|MediaStream} src - The url or audio element to create the audio node from.
     * @param {number} [sourceOffset=0] - Offset into the start of the source audio to start playing from.
     * @param {number} [preloadTime=4] - How long before a node is to be displayed to attmept to load it.
     * @param {Object} [imageElementAttributes] - Any attributes to be given to the underlying image element.
     * @return {AudioNode} A new audio node.
     *
     * @example
     * var canvasElement = document.getElementById("canvas");
     * var ctx = new VideoContext(canvasElement);
     * var audioNode = ctx.audio("ziggystardust.mp3");
     */
    audio(
        src: string | HTMLAudioElement | MediaStream,
        sourceOffset = 0,
        preloadTime = 4,
        audioElementAttributes = {}
    ) {
        let audioNode = new AudioNode(
            src,
            this._gl,
            this._renderGraph,
            this._currentTime,
            this._playbackRate,
            sourceOffset,
            preloadTime,
            undefined,
            audioElementAttributes
        );
        this._sourceNodes.push(audioNode);
        return audioNode;
    }

    /**
     * Create a new node representing an image source
     * @param {string|HTMLImageElement|ImageBitmap} src - The url or image element to create the image node from.
     * @param {number} [preloadTime=4] - How long before a node is to be displayed to attmept to load it.
     * @param {Object} [imageElementAttributes] - Any attributes to be given to the underlying image element.
     * @return {ImageNode} A new image node.
     *
     * @example
     * var canvasElement = document.getElementById("canvas");
     * var ctx = new VideoContext(canvasElement);
     * var imageNode = ctx.image("image.png");
     *
     * @example
     * var canvasElement = document.getElementById("canvas");
     * var imageElement = document.getElementById("image");
     * var ctx = new VideoContext(canvasElement);
     * var imageNode = ctx.image(imageElement);
     */
    image(
        src: string | HTMLImageElement | ImageBitmap,
        preloadTime = 4,
        imageElementAttributes = {}
    ) {
        let imageNode = new ImageNode(
            src,
            this._gl,
            this._renderGraph,
            this._currentTime,
            preloadTime,
            imageElementAttributes
        );
        this._sourceNodes.push(imageNode);
        return imageNode;
    }

    /**
     * Create a new node representing a canvas source
     * @param {Canvas} src - The canvas element to create the canvas node from.
     * @return {CanvasNode} A new canvas node.
     */
    canvas(canvas: HTMLCanvasElement) {
        let canvasNode = new CanvasNode(canvas, this._gl, this._renderGraph, this._currentTime);
        this._sourceNodes.push(canvasNode);
        return canvasNode;
    }

    /**
     * Create a new effect node.
     * @param {IDefinition} definition - this is an object defining the shaders, inputs, and properties of the compositing node to create. Builtin definitions can be found by accessing VideoContext.DEFINITIONS.
     * @return {EffectNode} A new effect node created from the passed definition
     */
    effect(definition: IDefinition) {
        let effectNode = new EffectNode(this._gl, this._renderGraph, definition);
        this._processingNodes.push(effectNode);
        return effectNode;
    }

    /**
     * Create a new compositiing node.
     *
     * Compositing nodes are used for operations such as combining multiple video sources into a single track/connection for further processing in the graph.
     *
     * A compositing node is slightly different to other processing nodes in that it only has one input in it's definition but can have unlimited connections made to it.
     * The shader in the definition is run for each input in turn, drawing them to the output buffer. This means there can be no interaction between the spearte inputs to a compositing node, as they are individually processed in seperate shader passes.
     *
     * @param {IDefinition} definition - this is an object defining the shaders, inputs, and properties of the compositing node to create. Builtin definitions can be found by accessing VideoContext.DEFINITIONS
     *
     * @return {CompositingNode} A new compositing node created from the passed definition.
     *
     * @example
     *
     * var canvasElement = document.getElementById("canvas");
     * var ctx = new VideoContext(canvasElement);
     *
     * //A simple compositing node definition which just renders all the inputs to the output buffer.
     * var combineDefinition = {
     *     vertexShader : "\
     *         attribute vec2 a_position;\
     *         attribute vec2 a_texCoord;\
     *         varying vec2 v_texCoord;\
     *         void main() {\
     *             gl_Position = vec4(vec2(2.0,2.0)*vec2(1.0, 1.0), 0.0, 1.0);\
     *             v_texCoord = a_texCoord;\
     *         }",
     *     fragmentShader : "\
     *         precision mediump float;\
     *         uniform sampler2D u_image;\
     *         uniform float a;\
     *         varying vec2 v_texCoord;\
     *         varying float v_progress;\
     *         void main(){\
     *             vec4 color = texture2D(u_image, v_texCoord);\
     *             gl_FragColor = color;\
     *         }",
     *     properties:{
     *         "a":{type:"uniform", value:0.0},
     *     },
     *     inputs:["u_image"]
     * };
     * //Create the node, passing in the definition.
     * var trackNode = videoCtx.compositor(combineDefinition);
     *
     * //create two videos which will play at back to back
     * var videoNode1 = ctx.video("video1.mp4");
     * videoNode1.play(0);
     * videoNode1.stop(10);
     * var videoNode2 = ctx.video("video2.mp4");
     * videoNode2.play(10);
     * videoNode2.stop(20);
     *
     * //Connect the nodes to the combine node. This will give a single connection representing the two videos which can
     * //be connected to other effects such as LUTs, chromakeyers, etc.
     * videoNode1.connect(trackNode);
     * videoNode2.connect(trackNode);
     *
     * //Don't do anything exciting, just connect it to the output.
     * trackNode.connect(ctx.destination);
     *
     */
    compositor(definition: IDefinition) {
        let compositingNode = new CompositingNode(this._gl, this._renderGraph, definition);
        this._processingNodes.push(compositingNode);
        return compositingNode;
    }

    /**
     * Instanciate a custom built source node
     * @param {typeof SourceNode} CustomSourceNode
     * @param {any} src
     * @param  {...any} options
     */
    customSourceNode<T extends any[]>(
        CustomSourceNode: {
            new (
                src: any,
                gl: WebGL2RenderingContext,
                renderGraph: RenderGraph,
                currentTime: number,
                ...args: T
            ): SourceNode;
        },
        src: any,
        ...options: T
    ) {
        const customSourceNode = new CustomSourceNode(
            src,
            this._gl,
            this._renderGraph,
            this._currentTime,
            ...options
        );
        this._sourceNodes.push(customSourceNode);
        return customSourceNode;
    }

    /**
     * @depricated
     */
    createCompositingNode(definition: IDefinition) {
        this._deprecate(
            "Warning: createCompositingNode will be deprecated in v1.0, please switch to using VideoContext.compositor()"
        );
        return this.compositor(definition);
    }

    /**
     * Create a new transition node.
     *
     * Transistion nodes are a type of effect node which have parameters which can be changed as events on the timeline.
     *
     * For example a transition node which cross-fades between two videos could have a "mix" property which sets the
     * progress through the transistion. Rather than having to write your own code to adjust this property at specfic
     * points in time a transition node has a "transition" function which takes a startTime, stopTime, targetValue, and a
     * propertyName (which will be "mix"). This will linearly interpolate the property from the curernt value to
     * tragetValue between the startTime and stopTime.
     *
     * @param {Object} definition - this is an object defining the shaders, inputs, and properties of the transition node to create.
     * @return {TransitionNode} A new transition node created from the passed definition.
     * @example
     *
     * var canvasElement = document.getElementById("canvas");
     * var ctx = new VideoContext(canvasElement);
     *
     * //A simple cross-fade node definition which cross-fades between two videos based on the mix property.
     * var crossfadeDefinition = {
     *     vertexShader : "\
     *        attribute vec2 a_position;\
     *        attribute vec2 a_texCoord;\
     *        varying vec2 v_texCoord;\
     *        void main() {\
     *            gl_Position = vec4(vec2(2.0,2.0)*a_position-vec2(1.0, 1.0), 0.0, 1.0);\
     *            v_texCoord = a_texCoord;\
     *         }",
     *     fragmentShader : "\
     *         precision mediump float;\
     *         uniform sampler2D u_image_a;\
     *         uniform sampler2D u_image_b;\
     *         uniform float mix;\
     *         varying vec2 v_texCoord;\
     *         varying float v_mix;\
     *         void main(){\
     *             vec4 color_a = texture2D(u_image_a, v_texCoord);\
     *             vec4 color_b = texture2D(u_image_b, v_texCoord);\
     *             color_a[0] *= mix;\
     *             color_a[1] *= mix;\
     *             color_a[2] *= mix;\
     *             color_a[3] *= mix;\
     *             color_b[0] *= (1.0 - mix);\
     *             color_b[1] *= (1.0 - mix);\
     *             color_b[2] *= (1.0 - mix);\
     *             color_b[3] *= (1.0 - mix);\
     *             gl_FragColor = color_a + color_b;\
     *         }",
     *     properties:{
     *         "mix":{type:"uniform", value:0.0},
     *     },
     *     inputs:["u_image_a","u_image_b"]
     * };
     *
     * //Create the node, passing in the definition.
     * var transitionNode = videoCtx.transition(crossfadeDefinition);
     *
     * //create two videos which will overlap by two seconds
     * var videoNode1 = ctx.video("video1.mp4");
     * videoNode1.play(0);
     * videoNode1.stop(10);
     * var videoNode2 = ctx.video("video2.mp4");
     * videoNode2.play(8);
     * videoNode2.stop(18);
     *
     * //Connect the nodes to the transistion node.
     * videoNode1.connect(transitionNode);
     * videoNode2.connect(transitionNode);
     *
     * //Set-up a transition which happens at the crossover point of the playback of the two videos
     * transitionNode.transition(8,10,1.0,"mix");
     *
     * //Connect the transition node to the output
     * transitionNode.connect(ctx.destination);
     *
     * //start playback
     * ctx.play();
     */
    transition(definition: IDefinition) {
        let transitionNode = new TransitionNode(this._gl, this._renderGraph, definition);
        this._processingNodes.push(transitionNode);
        return transitionNode;
    }

    _isStalled() {
        for (let i = 0; i < this._sourceNodes.length; i++) {
            const sourceNode = this._sourceNodes[i];
            if (!sourceNode._isReady()) {
                return true;
            }
        }
        return false;
    }

    /**
     * This allows manual calling of the update loop of the videoContext.
     *
     * @param {Number} dt - The difference in seconds between this and the previous calling of update.
     * @example
     *
     * var canvasElement = document.getElementById("canvas");
     * var ctx = new VideoContext(canvasElement, undefined, {"manualUpdate" : true});
     *
     * var previousTime;
     * function update(time){
     *     if (previousTime === undefined) previousTime = time;
     *     var dt = (time - previousTime)/1000;
     *     ctx.update(dt);
     *     previousTime = time;
     *     requestAnimationFrame(update);
     * }
     * update();
     *
     */
    update(dt: number) {
        this._update(dt);
    }

    _updateSourceNodes() {
        let sourcesPlaying = false;

        for (let i = 0; i < this._sourceNodes.length; i++) {
            let sourceNode = this._sourceNodes[i];

            if (this._state === VideoContext.STATE.STALLED) {
                if (sourceNode._isReady() && sourceNode._state === SOURCENODESTATE.playing) {
                    sourceNode._pause();
                }
            }
            if (
                this._state === VideoContext.STATE.PAUSED ||
                this._state === VideoContext.STATE.SEEKING
            ) {
                sourceNode._pause();
            }
            if (this._state === VideoContext.STATE.PLAYING) {
                sourceNode._play();
            }
            sourceNode._update(this._currentTime);
            if (
                sourceNode._state === SOURCENODESTATE.paused ||
                sourceNode._state === SOURCENODESTATE.playing
            ) {
                sourcesPlaying = true;
            }
        }
        return sourcesPlaying;
    }

    _update(dt: number) {
        //Remove any destroyed nodes
        this._sourceNodes = this._sourceNodes.filter((sourceNode) => {
            if (!sourceNode.destroyed) return sourceNode;
        });

        this._processingNodes = this._processingNodes.filter((processingNode) => {
            if (!processingNode.destroyed) return processingNode;
        });

        const ready = !this._isStalled();
        const needsRender =
            this._sourceNodes.some((node) => node.needsRender) ||
            this._processingNodes.some((node) => node.needsRender);
        const timeChanged = this._lastRenderTime !== this._currentTime;
        const renderNodes = ready && (needsRender || timeChanged) && this._renderNodeOnDemandOnly;

        if (
            this._state === VideoContext.STATE.PLAYING ||
            this._state === VideoContext.STATE.STALLED ||
            this._state === VideoContext.STATE.PAUSED ||
            this._state === VideoContext.STATE.SEEKING
        ) {
            if (this._state !== VideoContext.STATE.PAUSED) {
                this._callCallbacks(VideoContext.EVENTS.UPDATE);
            }

            if (
                this._state !== VideoContext.STATE.PAUSED &&
                this._state !== VideoContext.STATE.SEEKING
            ) {
                const wasStalled = this._state === VideoContext.STATE.STALLED;

                if (this._isStalled()) {
                    this._state = VideoContext.STATE.STALLED;

                    if (!wasStalled) {
                        this._callCallbacks(VideoContext.EVENTS.STALLED);
                    }
                } else {
                    this._state = VideoContext.STATE.PLAYING;
                    if (wasStalled) {
                        this._callCallbacks(VideoContext.EVENTS.PLAYING);
                    }
                }
            }

            if (this._state === VideoContext.STATE.PLAYING) {
                //Handle timeline callbacks.
                let activeCallbacks = new Map<number, TimelineCallback[]>();
                for (let callback of this._timelineCallbacks) {
                    if (
                        callback.time >= this.currentTime &&
                        callback.time < this._currentTime + dt * this._playbackRate
                    ) {
                        //group the callbacks by time
                        if (!activeCallbacks.has(callback.time))
                            activeCallbacks.set(callback.time, []);
                        activeCallbacks.get(callback.time)!.push(callback);
                    }
                }

                //Sort the groups of callbacks by the times of the groups
                let timeIntervals = Array.from(activeCallbacks.keys());
                timeIntervals.sort(function (a, b) {
                    return a - b;
                });

                for (let t of timeIntervals) {
                    let callbacks = activeCallbacks.get(t)!;
                    callbacks.sort(function (a, b) {
                        return a.ordering - b.ordering;
                    });
                    for (let callback of callbacks) {
                        callback.func();
                    }
                }

                this._currentTime += dt * this._playbackRate;
                if (this._currentTime > this.duration && this._endOnLastSourceEnd) {
                    //Do an update od the sourcenodes in case anything in the "ended" callbacks modifes currentTime and sources haven't had a chance to stop.
                    for (let i = 0; i < this._sourceNodes.length; i++) {
                        this._sourceNodes[i]._update(this._currentTime);
                    }
                    this._state = VideoContext.STATE.ENDED;
                    this._callCallbacks(VideoContext.EVENTS.ENDED);
                }
            }

            const sourcesPlaying = this._updateSourceNodes();

            if (
                sourcesPlaying !== this._sourcesPlaying &&
                this._state === VideoContext.STATE.PLAYING
            ) {
                if (sourcesPlaying === true) {
                    this._callCallbacks(VideoContext.EVENTS.CONTENT);
                } else {
                    this._callCallbacks(VideoContext.EVENTS.NOCONTENT);
                }
                this._sourcesPlaying = sourcesPlaying;
            }

            /*
             * Itterate the directed acyclic graph using Khan's algorithm (KHAAAAAN!).
             *
             * This has highlighted a bunch of ineffencies in the rendergraph class about how its stores connections.
             * Mainly the fact that to get inputs for a node you have to iterate the full list of connections rather than
             * a node owning it's connections.
             * The trade off with changing this is making/removing connections becomes more costly performance wise, but
             * this is definitely worth while because getting the connnections is a much more common operation.
             *
             * TL;DR Future matt - refactor this.
             *
             */
            let sortedNodes: GraphNode[] = [];
            let connections = this._renderGraph.connections.slice();
            let nodes = RenderGraph.getInputlessNodes(connections);

            while (nodes.length > 0) {
                let node = nodes.pop()!;
                sortedNodes.push(node);
                for (let edge of RenderGraph.outputEdgesFor(node, connections)) {
                    let index = connections.indexOf(edge);
                    if (index > -1) connections.splice(index, 1);
                    if (RenderGraph.inputEdgesFor(edge.destination, connections).length === 0) {
                        nodes.push(edge.destination);
                    }
                }
            }

            if (renderNodes) {
                this._gl.clearColor(0, 0, 0, 0.0);
                this._gl.clear(this._gl.COLOR_BUFFER_BIT);
            }

            for (let node of sortedNodes) {
                if (renderNodes && (node instanceof SourceNode || node instanceof ProcessingNode)) {
                    node._update(this._currentTime);
                }
                if ((this._sourceNodes as GraphNode[]).indexOf(node) === -1) {
                    if (
                        !this._renderNodeOnDemandOnly ||
                        this._state === VideoContext.STATE.PLAYING ||
                        this._state === VideoContext.STATE.SEEKING ||
                        renderNodes
                    ) {
                        (node as ProcessingNode)._update(this._currentTime);
                        (node as ProcessingNode)._render();
                    }
                }
                if (renderNodes) {
                    node.needsRender = false;
                }
            }

            // after nodes are rendered
            // update the previous time
            if (renderNodes) {
                this._lastRenderTime = this._currentTime;
            }
            if (this._state === VideoContext.STATE.SEEKING && ready) {
                this._state = VideoContext.STATE.PAUSED;
                this._callCallbacks(VideoContext.EVENTS.SEEKED);
            }
            if (this._runAfterNextRender && ready) {
                if (this._runAfterNextRender()) {
                    // Remove it if it ran successfully.
                    this._runAfterNextRender = undefined;
                }
            }
        }
    }

    /**
     * Destroy all nodes in the graph and reset the timeline. After calling this any created nodes will be unusable.
     */
    reset() {
        for (let callback of this._callbacks) {
            // FIXME: bug
            // this.unregisterCallback(callback);
            callback[1].forEach((cb) => this.unregisterCallback(cb));
        }
        for (let node of this._sourceNodes) {
            node.destroy();
        }
        for (let node of this._processingNodes) {
            node.destroy();
        }
        this._update(0);
        this._sourceNodes = [];
        this._processingNodes = [];
        this._timeline = [];
        this._state = VideoContext.STATE.PAUSED;
        this._currentTime = 0;
        this._playbackRate = 1.0;
        this._sourcesPlaying = undefined;
        Object.keys(VideoContext.EVENTS).forEach((name) =>
            this._callbacks.set(VideoContext.EVENTS[name as keyof typeof VideoContext.EVENTS], [])
        );
        this._timelineCallbacks = [];
        this._lastRenderTime = undefined;
    }

    _deprecate(msg: string) {
        console.log(msg);
    }

    static get DEFINITIONS() {
        return DEFINITIONS;
    }

    static get NODES() {
        return NODES;
    }

    /**
     * Get a JS Object containing the state of the VideoContext instance and all the created nodes.
     */
    snapshot() {
        return snapshot(this);
    }
}
