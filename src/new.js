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
            console.log(jsonresponse);
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

        shader.vertexShader = shader.vertexShader.replace(
            '#include <skinning_pars_vertex>',
            `
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
            skinMatrix  = bindMatrixInverse * skinMatrix * bindMatrix;

            objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;
         `
        );

        shader.vertexShader = shader.vertexShader.replace(
         '#include <skinning_vertex>',
         `
            vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );

            vec4 skinned = vec4( 0.0 );
            skinned += boneMatX * skinVertex * skinWeight.x;
            skinned += boneMatY * skinVertex * skinWeight.y;
            skinned += boneMatZ * skinVertex * skinWeight.z;
            skinned += boneMatW * skinVertex * skinWeight.w;

            transformed = ( bindMatrixInverse * skinned ).xyz;
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