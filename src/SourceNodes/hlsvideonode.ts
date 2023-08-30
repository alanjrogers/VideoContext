import HLSNode from "./hlsnode";

const TYPE = "HLSVideoNode";

export class HLSVideoNode extends HLSNode {
    /**
     * Initialise an instance of a VideoNode.
     * This should not be called directly, but created through a call to videoContext.hlsVideo();
     */
    constructor(...args: ConstructorParameters<typeof HLSNode>) {
        super(...args);
        this._displayName = TYPE;
        this._elementType = "video";
    }

    _createElement() {
        // Create a video element.
        const video = document.createElement("video");
        video.id = this._id;
        video.volume = this._attributes.volume!;
        this._element = video;
    }
}

export { TYPE as HLSVIDEOTYPE };

export default HLSVideoNode;
