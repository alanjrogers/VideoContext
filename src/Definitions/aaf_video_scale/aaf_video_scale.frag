#version 300 es

precision mediump float;
uniform sampler2D u_image;
uniform float scaleX;
uniform float scaleY;
uniform vec4 bColor;
in vec2 v_texCoord;
out vec4 outColor;

void main() {
    vec2 pos = vec2(v_texCoord[0] * 1.0f / scaleX - (1.0f / scaleX / 2.0f - 0.5f), v_texCoord[1] * 1.0f / scaleY - (1.0f / scaleY / 2.0f - 0.5f));
    outColor = texture(u_image, pos);
    if(pos[0] < 0.0f || pos[0] > 1.0f || pos[1] < 0.0f || pos[1] > 1.0f) {
        outColor = bColor;
    }
}
