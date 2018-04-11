if ( ! Detector.webgl ) Detector.addGetWebGLMessage();

var container = document.getElementById( 'container' );

var scene, renderer, camera, controls, stats, gui;
var mesh, skeleton;

var clock = new THREE.Clock();

init();
animate();

function init() {
    gui = new dat.GUI();
    camera = new THREE.PerspectiveCamera( 27, window.innerWidth / window.innerHeight, 1, 10000 );
    camera.position.z = 1200;

    scene = new THREE.Scene();
    scene.background = new THREE.Color( 0x333333 );
    scene.add( new THREE.AmbientLight( 0xffffff ) );

    renderer = new THREE.WebGLRenderer( { antialias: true } );
    renderer.setPixelRatio( window.devicePixelRatio );
    renderer.setSize( window.innerWidth, window.innerHeight );

    container.appendChild( renderer.domElement );

    url = '../models/skinned/marine/marine_anims_core.json';

    loaderType = 'object'
    new THREE.ObjectLoader().load( url, function ( loadedObject ) {

        loadedObject.traverse( function ( child ) {
            if ( child instanceof THREE.SkinnedMesh ) {
                mesh = child;
            }
        } );

        if ( mesh === undefined ) {
            alert( 'Unable to find a SkinnedMesh in this place:\n\n' + url + '\n\n' );
            return;
        }

        setUp();
    });

    stats = new Stats();
    document.body.appendChild( stats.dom );
}

function setUp() {

    // console.log(mesh.skeleton.boneInverses);


    var material = mesh.material;
    material.onBeforeCompile = function ( shader ) {

        console.log( shader );

        shader.vertexShader = shader.vertexShader.replace(
            '#include <skinning_pars_vertex>',
            `
            // quaternion functions
            vec4 quat_conj(vec4 q) {
                return vec4(-q.x, -q.y, -q.z, q.w);
            }

            vec4 quat_mult(vec4 q1, vec4 q2) {
                vec4 qr;
                qr.w = q1.w * q2.w - dot(q1.xyz, q2.xyz);
                qr.xyz = q1.w * q2.xyz + q2.w * q1.xyz + cross(q1.xyz, q2.xyz);
                return qr;
            }

            vec4 rot_quat_from_matrix(mat4 m) {
                vec4 qr;
                float m00 = m[0].x, m01 = m[1].x, m02 = m[2].x;
                float m10 = m[0].y, m11 = m[1].y, m12 = m[2].y;
                float m20 = m[0].z, m21 = m[1].z, m22 = m[2].z;

                float tr = m00 + m11 + m22;

                if (tr > 0.0) {
                    float S = sqrt(tr + 1.0) * 2.0; // S=4*qw
                    qr.w = 0.25 * S;
                    qr.x = (m21 - m12) / S;
                    qr.y = (m02 - m20) / S;
                    qr.z = (m10 - m01) / S;
                } else if ((m00 > m11) && (m00 > m22)) {
                    float S = sqrt(1.0 + m00 - m11 - m22) * 2.0; // S=4*qx
                    qr.w = (m21 - m12) / S;
                    qr.x = 0.25 * S;
                    qr.y = (m01 + m10) / S;
                    qr.z = (m02 + m20) / S;
                } else if (m11 > m22) {
                    float S = sqrt(1.0 + m11 - m00 - m22) * 2.0; // S=4*qy
                    qr.w = (m02 - m20) / S;
                    qr.x = (m01 + m10) / S;
                    qr.y = 0.25 * S;
                    qr.z = (m12 + m21) / S;
                } else {
                    float S = sqrt(1.0 + m22 - m00 - m11) * 2.0; // S=4*qz
                    qr.w = (m10 - m01) / S;
                    qr.x = (m02 + m20) / S;
                    qr.y = (m12 + m21) / S;
                    qr.z = 0.25 * S;
                }

                return qr;
            }

            // dual quaternion
            struct DualQuat {
                vec4 qr;
                vec4 qd;
            };

            DualQuat dquat_normalize(DualQuat q) {
                // float mag = sqrt(dot(q.qr, q.qr));
                float mag = length(q.qr);
                q.qr = q.qr / mag;
                q.qd = q.qd / mag;
                return q;
            }

            DualQuat dquat_from_matrix(mat4 m) {
                DualQuat q;
                q.qr = rot_quat_from_matrix(m);
                vec4 t = vec4(m[3].x, m[3].y, m[3].z, 0.0);
                q.qd = 0.5 * quat_mult(t, q.qr);
                q = dquat_normalize(q);
                return q;
            }

            DualQuat dquat_addition(DualQuat q1, DualQuat q2) {
                DualQuat q;
                q.qr = q1.qr + q2.qr;
                q.qd = q1.qd + q2.qd;
                return q;
            }

            DualQuat dquat_scale(DualQuat q, float s) {
                q.qr = q.qr * s;
                q.qd = q.qd * s;
                return q;
            }

            DualQuat dquat_mult(DualQuat q1, DualQuat q2) {
                DualQuat q;
                q.qr = quat_mult(q1.qr, q2.qr);
                q.qd = quat_mult(q1.qr, q2.qd) + quat_mult(q1.qd, q2.qr);
                return q;
            }

            vec3 dquat_transform_vertex(vec3 position, DualQuat q) {
                return position +
                        2.0 * cross(q.qr.xyz, cross(q.qr.xyz, position) + q.qr.w * position) +
                        2.0 * (q.qr.w * q.qd.xyz - q.qd.w * q.qr.xyz +
                            cross(q.qr.xyz, q.qd.xyz));
            }

            vec3 dquat_transform_normal(vec3 normal, DualQuat q) {
                return normal + 2.0 * cross(q.qr.xyz, cross(q.qr.xyz, normal) +
                          q.qr.w * normal);
            }

            uniform mat4 bindMatrix;
            uniform mat4 bindMatrixInverse;

            #ifdef BONE_TEXTURE
                uniform sampler2D boneTexture;
                uniform int boneTextureSize;

                mat4 getBoneMatrix( const in float i ) {

                    float j = i * 4.0;
                    float x = mod( j, float( boneTextureSize ) );
                    float y = floor( j / float( boneTextureSize ) );

                    float dx = 1.0 / float( boneTextureSize );
                    float dy = 1.0 / float( boneTextureSize );

                    y = dy * ( y + 0.5 );

                    vec4 v1 = texture2D( boneTexture, vec2( dx * ( x + 0.5 ), y ) );
                    vec4 v2 = texture2D( boneTexture, vec2( dx * ( x + 1.5 ), y ) );
                    vec4 v3 = texture2D( boneTexture, vec2( dx * ( x + 2.5 ), y ) );
                    vec4 v4 = texture2D( boneTexture, vec2( dx * ( x + 3.5 ), y ) );

                    mat4 bone = mat4( v1, v2, v3, v4 );

                    return bone;

                }
            #else

                uniform mat4 boneMatrices[ MAX_BONES ];
                mat4 getBoneMatrix( const in float i ) {
                    mat4 bone = boneMatrices[ int(i) ];
                    return bone;
                }

            #endif
            `
        );

        shader.vertexShader = shader.vertexShader.replace(
         '#include <skinbase_vertex>',
         `
            DualQuat boneQX = dquat_from_matrix(getBoneMatrix( skinIndex.x ));
            DualQuat boneQY = dquat_from_matrix(getBoneMatrix( skinIndex.y ));
            DualQuat boneQZ = dquat_from_matrix(getBoneMatrix( skinIndex.z ));
            DualQuat boneQW = dquat_from_matrix(getBoneMatrix( skinIndex.w ));

            DualQuat blendedDQ = DualQuat(vec4(0.0), vec4(0.0));

            if (dot(boneQX.qr,boneQY.qr) < 0.0)
                boneQY = dquat_scale(boneQY, -1.0);

            if (dot(boneQX.qr,boneQZ.qr) < 0.0)
                boneQZ = dquat_scale(boneQZ, -1.0);

            if (dot(boneQX.qr,boneQW.qr) < 0.0)
                boneQW = dquat_scale(boneQW, -1.0);

            boneQX = dquat_scale(boneQX, skinWeight.x);
            boneQY = dquat_scale(boneQY, skinWeight.y);
            boneQZ = dquat_scale(boneQZ, skinWeight.z);
            boneQW = dquat_scale(boneQW, skinWeight.w);

            blendedDQ = dquat_addition(boneQX, boneQY);
            blendedDQ = dquat_addition(blendedDQ, boneQZ);
            blendedDQ = dquat_addition(blendedDQ, boneQW);

            blendedDQ = dquat_normalize(blendedDQ);
         `
        );

        shader.vertexShader = shader.vertexShader.replace(
         '#include <skinnormal_vertex>',
         `
            objectNormal = (bindMatrix * vec4(objectNormal, 0.0)).xyz;
            objectNormal = dquat_transform_normal(objectNormal, blendedDQ);
            objectNormal = (bindMatrixInverse * vec4(objectNormal, 0.0)).xyz;
         `
        );

        shader.vertexShader = shader.vertexShader.replace(
         '#include <skinning_vertex>',
         `
            transformed = (bindMatrix * vec4(transformed, 1.0)).xyz;
            transformed = dquat_transform_vertex(transformed, blendedDQ);
            transformed = (bindMatrixInverse * vec4(transformed, 1.0)).xyz;
         `
        );

        materialShader = shader;
    }

    // Add mesh and skeleton helper to scene

    mesh.rotation.y = - 180 * Math.PI / 180;
    scene.add( mesh );

    skeleton = new THREE.SkeletonHelper( mesh );
    skeleton.visible = false;
    scene.add( skeleton );


    // Initialize camera and camera controls

    var radius = mesh.geometry.boundingSphere.radius;

    var aspect = window.innerWidth / window.innerHeight;
    camera = new THREE.PerspectiveCamera( 30, aspect, 1, 1000 );
    camera.position.set( 0.0, radius * 2.5, radius * 3.5 );

    controls = new THREE.OrbitControls( camera, renderer.domElement );
    controls.target.set( 0, radius, 0 );
    controls.update();

    setupDatGui();
}

function showSkeleton(visibility) {
    skeleton.visible = visibility;
}

function showMesh(visibility) {
    mesh.visible = visibility;
}


function setupDatGui () {

    settings = {
        'show-skeleton': false,
        'show-mesh': true,
    }

    console.log('init contols..')

    var folder = gui.addFolder( "General Options" );
    folder.add( settings, 'show-skeleton' ).onChange( showSkeleton );
    folder.add( settings, 'show-mesh' ).onChange( showMesh );

    // folder.add( mesh, "pose" );
    // folder.__controllers[ 1 ].name( ".pose()" );


    var bones = mesh.skeleton.bones;

    var bone = bones[0];
    folder = gui.addFolder(bone.name);
    folder.add( bone.position, 'x', - 10 + bone.position.x, 10 + bone.position.x );
    folder.add( bone.position, 'y', - 10 + bone.position.y, 10 + bone.position.y );
    folder.add( bone.position, 'z', - 10 + bone.position.z, 10 + bone.position.z );

    folder.add( bone.rotation, 'x', - Math.PI * 0.5, Math.PI * 0.5 );
    folder.add( bone.rotation, 'y', - Math.PI * 0.5, Math.PI * 0.5 );
    folder.add( bone.rotation, 'z', - Math.PI * 0.5, Math.PI * 0.5 );

    folder.add( bone.scale, 'x', 0, 2 );
    folder.add( bone.scale, 'y', 0, 2 );
    folder.add( bone.scale, 'z', 0, 2 );

    folder.__controllers[ 0 ].name( "position.x" );
    folder.__controllers[ 1 ].name( "position.y" );
    folder.__controllers[ 2 ].name( "position.z" );

    folder.__controllers[ 3 ].name( "rotation.x" );
    folder.__controllers[ 4 ].name( "rotation.y" );
    folder.__controllers[ 5 ].name( "rotation.z" );

    folder.__controllers[ 6 ].name( "scale.x" );
    folder.__controllers[ 7 ].name( "scale.y" );
    folder.__controllers[ 8 ].name( "scale.z" );

    for ( var i = 1; i < bones.length; i ++ ) {
        var bone = bones[ i ];
        folder = gui.addFolder(bone.name);

        if (bone.name == 'Fbx01_R_Forearm') {
            bone.rotation.x = 2.0;
        }

        folder.add( bone.rotation, 'x', - 5 * Math.PI, 5 * Math.PI );
        folder.add( bone.rotation, 'y', - 5 * Math.PI, 5 * Math.PI );
        folder.add( bone.rotation, 'z', - 5 * Math.PI, 5 * Math.PI );

        folder.__controllers[ 0 ].name( "rotation.x" );
        folder.__controllers[ 1 ].name( "rotation.y" );
        folder.__controllers[ 2 ].name( "rotation.z" );
    }

}

function animate() {
    requestAnimationFrame( animate );
    render();
    stats.update();
}

function render() {
    renderer.render( scene, camera );
}