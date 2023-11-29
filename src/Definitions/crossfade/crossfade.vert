#version 300 es

in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;
void main() {
    gl_Position = vec4(vec2(2.0f, 2.0f) * a_position - vec2(1.0f, 1.0f), 0.0f, 1.0f);
    v_texCoord = a_texCoord;
}
