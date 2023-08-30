import HLSNode from "./hlsnode";

const TYPE = "HLSAudioNode";

export class HLSAudioNode extends HLSNode {
    /**
     * Initialise an instance of a VideoNode.
     * This should not be called directly, but created through a call to videoContext.hlsAudio();
     */
    constructor(...args: ConstructorParameters<typeof HLSNode>) {
        super(...args);
        this._displayName = TYPE;
        this._elementType = "audio";
        if (this._texture !== null) {
            this._gl.deleteTexture(this._texture);
            this._texture = null;
        }
    }

    _createElement() {
        // Create a audio element.
        const audio = document.createElement("audio");
        audio.id = this._id;
        audio.volume = this._attributes.volume!;
        this._element = audio;
    }

    _update(currentTime: number) {
        super._update(currentTime, false);
    }
}

export { TYPE as HLSAUDIOTYPE };

export default HLSAudioNode;
