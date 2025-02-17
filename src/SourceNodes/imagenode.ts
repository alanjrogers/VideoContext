//Matthew Shotton, R&D User Experience,© BBC 2015
import RenderGraph from "../rendergraph";
import SourceNode, { SOURCENODESTATE } from "./sourcenode";

const TYPE = "CanvasNode";
class ImageNode extends SourceNode {
    _preloadTime: number;
    _attributes: Record<string, any>;
    _textureUploaded: boolean;
    _image: HTMLImageElement | undefined;
    /**
     * Initialise an instance of an ImageNode.
     * This should not be called directly, but created through a call to videoContext.createImageNode();
     */
    constructor(
        src: string | HTMLImageElement | ImageBitmap,
        gl: WebGL2RenderingContext,
        renderGraph: RenderGraph,
        currentTime: number,
        preloadTime = 4,
        attributes = {}
    ) {
        super(src, gl, renderGraph, currentTime);
        this._preloadTime = preloadTime;
        this._attributes = attributes;
        this._textureUploaded = false;
        this._displayName = TYPE;
    }

    get elementURL() {
        return this._elementURL;
    }

    _load() {
        if (this._image !== undefined) {
            for (var key in this._attributes) {
                (this._image as any)[key] = this._attributes[key];
            }
            return;
        }
        if (this._isResponsibleForElementLifeCycle) {
            super._load();
            this._image = new Image();
            this._image.setAttribute("crossorigin", "anonymous");
            // It's important to set the `onload` event before the `src` property
            // https://stackoverflow.com/questions/12354865/image-onload-event-and-browser-cache?answertab=active#tab-top
            this._image.onload = () => {
                this._ready = true;
                if (window.createImageBitmap) {
                    window
                        .createImageBitmap(
                            this._image!,
                            0,
                            0,
                            this._image!.width,
                            this._image!.height,
                            { imageOrientation: "flipY" }
                        )
                        .then((imageBitmap) => {
                            this._element = imageBitmap;
                            this._triggerCallbacks("loaded");
                        });
                } else {
                    this._element = this._image;
                    this._triggerCallbacks("loaded");
                }
            };
            this._image.src = this._elementURL as string;
            this._image.onerror = () => {
                console.error("ImageNode failed to load. url:", this._elementURL);
            };

            for (let key in this._attributes) {
                (this._image as any)[key] = this._attributes[key];
            }
        }
        this._image!.onerror = () => {
            console.debug("Error with element", this._image);
            this._state = SOURCENODESTATE.error;
            //Event though there's an error ready should be set to true so the node can output transparenn
            this._ready = true;
            this._triggerCallbacks("error");
        };
    }

    _unload() {
        super._unload();
        if (this._isResponsibleForElementLifeCycle) {
            if (this._image !== undefined) {
                this._image.src = "";
                this._image.onerror = null;
                this._image = undefined;
                delete this._image;
            }
            if (this._element instanceof window.ImageBitmap) {
                this._element.close();
            }
        }
        this._ready = false;
    }

    _seek(time: number) {
        super._seek(time);
        if (this.state === SOURCENODESTATE.playing || this.state === SOURCENODESTATE.paused) {
            if (this._image === undefined) this._load();
        }
        if (
            (this._state === SOURCENODESTATE.sequenced || this._state === SOURCENODESTATE.ended) &&
            this._element !== undefined
        ) {
            this._unload();
        }
    }

    _update(currentTime: number) {
        //if (!super._update(currentTime)) return false;
        if (this._textureUploaded) {
            super._update(currentTime, false);
        } else {
            super._update(currentTime);
        }

        if (
            this._startTime - this._currentTime <= this._preloadTime &&
            this._state !== SOURCENODESTATE.waiting &&
            this._state !== SOURCENODESTATE.ended
        )
            this._load();

        if (this._state === SOURCENODESTATE.playing) {
            return true;
        } else if (this._state === SOURCENODESTATE.paused) {
            return true;
        } else if (this._state === SOURCENODESTATE.ended && this._image !== undefined) {
            this._unload();
            return false;
        }
    }
}

export { TYPE as IMAGETYPE };

export default ImageNode;
