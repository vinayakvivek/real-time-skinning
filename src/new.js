if ( ! Detector.webgl ) Detector.addGetWebGLMessage();

var container = document.getElementById( 'container' );

var scene, renderer, camera, controls, stats, gui;
var mesh, skeleton, cors;

var clock = new THREE.Clock();

init();
animate();

function loadJSON(fileName, callback) {

    var xobj = new XMLHttpRequest();
    xobj.overrideMimeType("application/json");
    xobj.open('GET', fileName, true);
    xobj.onreadystatechange = function() {
        if (xobj.readyState == 4 && xobj.status == "200") {
            // .open will NOT return a value but simply returns undefined in async mode so use a callback
            callback(xobj.responseText);
        }
    }
    xobj.send(null);
}

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

        // setUp();
        loadJSON('../cors.json', function(response) {
            jsonresponse = JSON.parse(response);
            // console.log(jsonresponse);
            cors = jsonresponse;
            setUp();
        });
    });

    stats = new Stats();
    document.body.appendChild( stats.dom );
}

function setUp() {

    // console.log(mesh.skeleton.boneInverses);

    var material = mesh.material;

    material.onBeforeCompile = function ( shader ) {

        console.log( shader );

        shader.vertexShader = 'attribute vec3 cor;\n' + shader.vertexShader;

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

            mat4 quat_to_matrix(vec4 q) {
                mat4 m1 = mat4(
                    vec4(q.w, -1.0*q.z, q.y, -1.0*q.x),
                    vec4(q.z, q.w, -1.0*q.x, -1.0*q.y),
                    vec4(-1.0*q.y, q.x, q.w, -1.0*q.z),
                    vec4(q.x, q.y, q.z, q.w)
                );

                mat4 m2 = mat4(
                    vec4(q.w, -1.0*q.z, q.y, q.x),
                    vec4(q.z, q.w, -1.0*q.x, q.y),
                    vec4(-1.0*q.y, q.x, q.w, q.z),
                    vec4(-1.0*q.x, -1.0*q.y, -1.0*q.z, q.w)
                );

                return m1 * m2;
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
            mat4 boneMatX = getBoneMatrix( skinIndex.x );
            mat4 boneMatY = getBoneMatrix( skinIndex.y );
            mat4 boneMatZ = getBoneMatrix( skinIndex.z );
            mat4 boneMatW = getBoneMatrix( skinIndex.w );

            vec4 boneQX = rot_quat_from_matrix(boneMatX);
            vec4 boneQY = rot_quat_from_matrix(boneMatY);
            vec4 boneQZ = rot_quat_from_matrix(boneMatZ);
            vec4 boneQW = rot_quat_from_matrix(boneMatW);

            vec4 blendedQ = vec4(0.0);

            blendedQ = skinWeight.x * boneQX;

            if (dot(blendedQ, boneQY) < 0.0)
                boneQY = -1.0 * boneQY;

            blendedQ += skinWeight.y * boneQY;

            if (dot(blendedQ, boneQZ) < 0.0)
                boneQZ = -1.0 * boneQZ;

            blendedQ += skinWeight.z * boneQZ;

            if (dot(blendedQ, boneQW) < 0.0)
                boneQW = -1.0 * boneQW;

            blendedQ += skinWeight.w * boneQW;

            blendedQ = blendedQ / length(blendedQ);
            mat4 R = quat_to_matrix(blendedQ);

            R[3] = vec4(0.0, 0.0, 0.0, 1.0);
            R[1].w = 0.0;
            R[2].w = 0.0;
            R[3].w = 0.0;
         `
        );

        shader.vertexShader = shader.vertexShader.replace(
         '#include <skinnormal_vertex>',
         `
            mat4 skinMatrix = mat4( 0.0 );
            skinMatrix += skinWeight.x * boneMatX;
            skinMatrix += skinWeight.y * boneMatY;
            skinMatrix += skinWeight.z * boneMatZ;
            skinMatrix += skinWeight.w * boneMatW;
            // skinMatrix  = bindMatrixInverse * skinMatrix * bindMatrix;

            // objectNormal = vec4(bindMatrixInverse * skinMatrix * bindMatrix * vec4( objectNormal, 0.0 ) ).xyz;

            objectNormal = (bindMatrix * vec4(objectNormal, 0.0)).xyz;
            objectNormal = (R * vec4(objectNormal, 0.0)).xyz;
            objectNormal = (bindMatrixInverse * vec4(objectNormal, 0.0)).xyz;
         `
        );

        // **************** TODO *******************
        shader.vertexShader = shader.vertexShader.replace(
         '#include <skinning_vertex>',
         `
            // skinMatrix = skinMatrix * bindMatrix;
            // R = R * bindMatrix;
            vec3 cor_lbs = (skinMatrix * vec4(cor, 1.0)).xyz;
            vec3 t = cor_lbs - (R * vec4(cor, 1.0)).xyz;

            // vec3 skinVertex = (R * vec4(transformed, 1.0)).xyz + t;
            // transformed = (bindMatrixInverse * vec4(skinVertex, 1.0)).xyz;

            vec3 skinVertex = (bindMatrix * vec4(transformed, 1.0)).xyz;
            // skinVertex = (R * vec4(skinVertex, 1.0)).xyz + t;
            skinVertex = (skinMatrix * vec4(skinVertex, 1.0)).xyz;
            transformed = (bindMatrixInverse * vec4(skinVertex, 1.0)).xyz;
         `
        );

        materialShader = shader;
    }

    // change to buffer geometry

    boundingSphere = mesh.geometry.boundingSphere;

    var bufferGeometry = new THREE.BufferGeometry();
    bufferGeometry.fromGeometry(mesh.geometry);

    // add cor attribute
    a_cors = []
    for (var i = 0; i < cors.length; ++i) {
        a_cors.push(cors[i]['x']);
        a_cors.push(cors[i]['y']);
        a_cors.push(cors[i]['z']);
    }

    var corAttribute = new THREE.Float32BufferAttribute(a_cors, 3);
    bufferGeometry.addAttribute('cor', corAttribute);

    mesh.geometry = bufferGeometry;

    // console.log(Object.keys(bufferGeometry));
    // console.log(bufferGeometry.boundingSphere);
    console.log(bufferGeometry);

    // Add mesh and skeleton helper to scene

    mesh.rotation.y = - 180 * Math.PI / 180;
    scene.add( mesh );

    skeleton = new THREE.SkeletonHelper( mesh );
    skeleton.visible = false;
    scene.add( skeleton );


    // Initialize camera and camera controls

    var radius = boundingSphere.radius;

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