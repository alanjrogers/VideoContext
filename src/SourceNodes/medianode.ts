//Matthew Shotton, R&D User Experience,© BBC 2015
import RenderGraph from "../rendergraph";
import type VideoElementCache from "../videoelementcache";
import SourceNode, { SOURCENODESTATE } from "./sourcenode";

type GetNonFunctionPartialOfType<T> = Pick<
    T,
    {
        [P in keyof T]: T[P] extends Function ? never : P;
    }[keyof T]
>;

class MediaNode extends SourceNode {
    _globalPlaybackRate: number;
    _playbackRateUpdated: boolean;
    _elementType: string | undefined;
    _sourceOffset: number;
    _preloadTime: number;
    _mediaElementCache: VideoElementCache | undefined;
    _playbackRate: number;
    _attributes: Partial<GetNonFunctionPartialOfType<HTMLMediaElement>>;
    _loopElement: boolean;
    _element: HTMLVideoElement | HTMLAudioElement | undefined;
    _loadTriggered: boolean | undefined;
    /**
     * Initialise an instance of a MediaNode.
     * This should not be called directly, but extended by other Node Types which use a `HTMLMediaElement`.
     */
    constructor(
        src: any,
        gl: WebGL2RenderingContext,
        renderGraph: RenderGraph,
        currentTime: number,
        globalPlaybackRate = 1.0,
        sourceOffset = 0,
        preloadTime = 4,
        mediaElementCache = undefined as VideoElementCache | undefined,
        attributes = {}
    ) {
        super(src, gl, renderGraph, currentTime);
        this._preloadTime = preloadTime;
        this._sourceOffset = sourceOffset;
        this._globalPlaybackRate = globalPlaybackRate;
        this._mediaElementCache = mediaElementCache;
        this._playbackRate = 1.0;
        this._playbackRateUpdated = true;
        this._attributes = Object.assign({ volume: 1.0 }, attributes);
        this._loopElement = false;
        if (this._attributes.loop) {
            this._loopElement = this._attributes.loop;
        }
    }

    set playbackRate(playbackRate) {
        this._playbackRate = playbackRate;
        this._playbackRateUpdated = true;
    }

    set stretchPaused(stretchPaused) {
        super.stretchPaused = stretchPaused;
        if (this._element) {
            if (this._stretchPaused) {
                this._element.pause();
            } else {
                if (this._state === SOURCENODESTATE.playing && !this._isElementPlaying) {
                    this._element.play();
                }
            }
        }
    }

    get stretchPaused() {
        return this._stretchPaused;
    }

    get playbackRate() {
        return this._playbackRate;
    }

    get elementURL() {
        return this._elementURL;
    }

    get _isElementPlaying() {
        if (this._element === undefined) {
            return false;
        }
        return (
            this._element.currentTime > 0 &&
            !this._element.paused &&
            !this._element.ended &&
            this._element.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
        );
    }

    /**
     * @property {Boolean}
     * @summary - Check if the element is waiting on the network to continue playback
     */

    get _buffering() {
        if (this._element) {
            return this._element.readyState < HTMLMediaElement.HAVE_FUTURE_DATA;
        }

        return false;
    }

    set volume(volume: number) {
        this._attributes.volume = volume;
        if (this._element !== undefined) this._element.volume = this._attributes.volume;
    }

    _triggerLoad() {
        // If the user hasn't supplied an element, videocontext is responsible for the element
        if (this._isResponsibleForElementLifeCycle) {
            if (this._mediaElementCache) {
                /**
                 * Get a cached video element and also pass this instance so the
                 * cache can access the current play state.
                 */
                this._element = this._mediaElementCache.getElementAndLinkToNode(this);
            } else {
                this._element = document.createElement(this._elementType!) as HTMLVideoElement;
                this._element.setAttribute("crossorigin", "anonymous");
                this._element.setAttribute("webkit-playsinline", "");
                this._element.setAttribute("playsinline", "");
                // This seems necessary to allow using video as a texture. See:
                // https://bugs.chromium.org/p/chromium/issues/detail?id=898550
                // https://github.com/pixijs/pixi.js/issues/5996
                this._element.preload = "auto";
                this._playbackRateUpdated = true;
            }
            this._element.volume = this._attributes.volume!;
            if (window.MediaStream !== undefined && this._elementURL instanceof MediaStream) {
                this._element.srcObject = this._elementURL;
            } else {
                this._element.src = this._elementURL as string;
            }
        }
        // at this stage either the user or the element cache should have provided an element
        if (this._element) {
            for (let key in this._attributes) {
                (this._element as any)[key] = (this._attributes as any)[key];
            }

            let currentTimeOffset = 0;
            if (this._currentTime > this._startTime)
                currentTimeOffset = this._currentTime - this._startTime;
            this._element.currentTime = this._sourceOffset + currentTimeOffset;
            this._element.onerror = () => {
                if (this._element === undefined) return;
                console.debug("Error with element", this._element);
                this._state = SOURCENODESTATE.error;
                //Event though there's an error ready should be set to true so the node can output transparenn
                this._ready = true;
                this._triggerCallbacks("error");
            };
        } else {
            // If the element doesn't exist for whatever reason enter the error state.
            this._state = SOURCENODESTATE.error;
            this._ready = true;
            this._triggerCallbacks("error");
        }

        this._loadTriggered = true;
    }

    /**
     * _load has two functions:
     *
     * 1. `_triggerLoad` which ensures the element has the correct src and is at the correct currentTime,
     *     so that the browser can start fetching media.
     *
     * 2.  `shouldPollForElementReadyState` waits until the element has a "readState" that signals there
     *     is enough media to start playback. This is a little confusing as currently structured.
     *     We're using the _update loop to poll the _load function which checks the element status.
     *     When ready we fire off the "loaded callback"
     *
     */

    _load() {
        super._load();

        /**
         * We've got to be careful here as _load is called many times whilst waiting for the element to buffer
         * and this function should only be called once.
         * This is step one in what should be a more thorough refactor
         */
        if (!this._loadTriggered) {
            this._triggerLoad();
        }

        const shouldPollForElementReadyState = this._element !== undefined;
        /**
         * this expression is effectively polling the element, waiting for it to buffer
         * it gets called a lot of time
         */
        if (shouldPollForElementReadyState) {
            if (
                this._element!.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA &&
                !this._element!.seeking
            ) {
                // at this point the element has enough data for current playback position
                // and at least a couple of frames into the future

                // Check if the duration has changed. Update if necessary.
                // this could potentially go in the normal update loop but I don't want to change
                // too many things at once
                if (this._loopElement === false) {
                    if (this._stopTime === Infinity || this._stopTime == undefined) {
                        this._stopTime = this._startTime + this._element!.duration;
                        this._triggerCallbacks("durationchange", this.duration);
                    }
                }

                // signal to user that this node has "loaded"
                if (this._ready !== true) {
                    this._triggerCallbacks("loaded");
                    this._playbackRateUpdated = true;
                }

                this._ready = true;
            } else {
                if (this._state !== SOURCENODESTATE.error) {
                    this._ready = false;
                }
            }
        }
    }

    _unload() {
        super._unload();
        if (this._isResponsibleForElementLifeCycle && this._element !== undefined) {
            this._element.removeAttribute("src");
            this._element.srcObject = undefined!;
            this._element.load();
            for (let key in this._attributes) {
                this._element.removeAttribute(key);
            }
            // Unlink this form the cache, freeing up the element for another media node
            if (this._mediaElementCache)
                this._mediaElementCache.unlinkNodeFromElement(this._element);
            this._element = undefined;
            if (!this._mediaElementCache) delete this._element;
        }
        // reset class to initial state
        this._ready = false;
        // For completeness. I couldn't find a path that required reuse of this._loadTriggered after _unload.
        this._loadTriggered = false;
    }

    _seek(time: number) {
        super._seek(time);
        if (this.state === SOURCENODESTATE.playing || this.state === SOURCENODESTATE.paused) {
            if (this._element === undefined) this._load();
            let relativeTime = this._currentTime - this._startTime + this._sourceOffset;
            this._element!.currentTime = relativeTime;
            this._ready = false;
        }
        if (
            (this._state === SOURCENODESTATE.sequenced || this._state === SOURCENODESTATE.ended) &&
            this._element !== undefined &&
            !this._isInPreloadWindow
        ) {
            this._unload();
        }
    }

    get _isInPreloadWindow(): boolean {
        if (
            this._startTime - this._currentTime <= this._preloadTime * this._playbackRate &&
            this._state !== SOURCENODESTATE.waiting &&
            this._state !== SOURCENODESTATE.ended
        ) {
            return true;
        }
        return false;
    }

    _update(currentTime: number, triggerTextureUpdate = true): boolean | void {
        //if (!super._update(currentTime)) return false;
        super._update(currentTime, triggerTextureUpdate);
        //check if the media has ended
        if (this._element !== undefined) {
            if (this._element.ended) {
                this._state = SOURCENODESTATE.ended;
                this._triggerCallbacks("ended");
            }
        }

        if (this._isInPreloadWindow) {
            this._load();
        }

        if (this._state === SOURCENODESTATE.playing) {
            if (this._playbackRateUpdated) {
                this._element!.playbackRate = this._globalPlaybackRate * this._playbackRate;
                this._playbackRateUpdated = false;
            }
            if (!this._isElementPlaying) {
                this._element!.play();
                if (this._stretchPaused) {
                    this._element!.pause();
                }
            }
            return true;
        } else if (this._state === SOURCENODESTATE.paused) {
            this._element!.pause();
            return true;
        } else if (this._state === SOURCENODESTATE.ended && this._element !== undefined) {
            this._element.pause();
            if (this._isElementPlaying) {
                this._unload();
            }
            return false;
        } else if (this._state === SOURCENODESTATE.sequenced && this._element !== undefined) {
            this._element.pause();
            this._element.currentTime = this._sourceOffset;
            if (!this._isInPreloadWindow) {
                this._unload();
            }
            return false;
        }
    }

    clearTimelineState() {
        super.clearTimelineState();
        if (this._element !== undefined) {
            this._element.pause();
        }
        this._unload();
    }

    destroy() {
        if (this._element) this._element.pause();
        super.destroy();
    }
}

export default MediaNode;
