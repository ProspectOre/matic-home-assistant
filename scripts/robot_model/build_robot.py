"""Build the original Matic-shaped marker and its Cycles sprite atlas.

Run with Blender 4.5 LTS and cwebp on PATH:
    blender -b -P scripts/robot_model/build_robot.py

Pillow (the project's Python dependency) packs the rendered layers. Use -- after
Blender's arguments for --work-dir, --python, --samples or --preview. No .blend,
photographs, vendor meshes, textures or logos are used or saved. Dimensions are
from https://maticrobots.com/product; geometry is constructed below in meters.
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import sys
import tempfile
import traceback
from pathlib import Path

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "custom_components/matic_robot/map_studio_v4/assets"
FRAME = 128
HEADINGS = 32
PITCHES = (90, 55, 25)
FRAME_METERS = 0.66
LENGTH_METERS = 0.378


def material(name, color, roughness, metallic=0):
    """Use physically based surfaces, with no external texture inputs."""
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    shader = result.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    return result


def finish(obj, name, surface, bevel=0):
    obj.name = name
    obj.data.materials.append(surface)
    if bevel:
        edge = obj.modifiers.new("Moulded edge", "BEVEL")
        edge.width = bevel
        edge.segments = 6
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    obj.modifiers.new("Surface normals", "WEIGHTED_NORMAL")
    return obj


def box(name, location, size, surface, bevel):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, name, surface, bevel)


def cylinder(name, location, radius, depth, surface, axis="Y", bevel=0.001):
    rotation = (math.pi / 2, 0, 0) if axis == "Y" else (0, math.pi / 2, 0)
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=96,
        radius=radius,
        depth=depth,
        location=location,
        rotation=rotation,
    )
    return finish(bpy.context.object, name, surface, bevel)


def rounded_lid(name, location, size, radius, surface):
    """Round the footprint independently of the very thin moulded lid edge."""
    length, width, height = size
    outline = []
    for corner, (x, y) in enumerate(((1, 1), (-1, 1), (-1, -1), (1, -1))):
        for step in range(13):
            angle = (corner + step / 12) * math.pi / 2
            outline.append(
                (
                    x * (length / 2 - radius) + radius * math.cos(angle),
                    y * (width / 2 - radius) + radius * math.sin(angle),
                )
            )
    count = len(outline)
    vertices = [(x, y, z) for z in (-height / 2, height / 2) for x, y in outline]
    faces = [tuple(reversed(range(count))), tuple(range(count, count * 2))]
    faces.extend(
        (i, (i + 1) % count, (i + 1) % count + count, i + count) for i in range(count)
    )
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    return finish(obj, name, surface, 0.001)


def make_robot():
    white = material("Satin white moulded polymer", (0.8, 0.815, 0.82), 0.29)
    rubber = material("Soft charcoal rubber", (0.018, 0.021, 0.024), 0.76)
    band = material("Glossy sensor glass", (0.009, 0.014, 0.019), 0.16)
    lens = material("Camera lenses", (0.015, 0.026, 0.034), 0.075, 0.32)
    grey = material("Neutral lid seam", (0.34, 0.36, 0.37), 0.43)
    # Published body: 11 x 9.4 x 7.8 inches. Wheel faces define the width.
    box("Tall body", (-0.044, 0, 0.101), (0.2794, 0.211, 0.154), white, 0.026)
    box("Lower bumper", (-0.044, 0, 0.027), (0.263, 0.213, 0.009), rubber, 0.004)
    box("Upper camera band", (-0.044, 0, 0.178), (0.2794, 0.229, 0.032), band, 0.016)
    seam = rounded_lid(
        "Tintable lid seam", (-0.056, 0, 0.1938), (0.249, 0.205, 0.004), 0.025, grey
    )
    seam.pass_index = 1
    rounded_lid(
        "Bevelled white lid", (-0.056, 0, 0.195), (0.245, 0.201, 0.0062), 0.023, white
    )
    # Two large side wheels with flush white hubs and individually modelled tread.
    for side in (-1, 1):
        y = side * 0.1098
        cylinder("Rubber wheel", (-0.061, y, 0.079), 0.078, 0.019, rubber)
        cylinder(
            "White wheel hub", (-0.061, y + side * 0.0103, 0.079), 0.066, 0.002, white
        )
        for i in range(56):
            angle = i * math.tau / 56
            tread = box(
                "Wheel tread",
                (
                    -0.061 + math.sin(angle) * 0.0776,
                    y,
                    0.079 + math.cos(angle) * 0.0776,
                ),
                (0.0034, 0.0195, 0.002),
                rubber,
                0.0006,
            )
            tread.rotation_euler.y = angle
    # Front cameras sit in the upper dark band, above the articulated head.
    for y in (-0.074, 0.074):
        cylinder("Camera bezel", (0.0955, y, 0.180), 0.010, 0.002, rubber, "X")
        cylinder("Camera glass", (0.097, y, 0.180), 0.0072, 0.001, lens, "X")
    box("Front visor", (0.096, 0, 0.178), (0.002, 0.071, 0.012), band, 0.004)
    # Published cleaning head: 4.1 x 9.4 x 3 inches; it projects ahead of the body.
    box("Head linkage", (0.099, 0, 0.057), (0.07, 0.10, 0.046), white, 0.015)
    box(
        "Cleaning head bumper",
        (0.142, 0, 0.025),
        (0.10414, 0.23876, 0.032),
        rubber,
        0.014,
    )
    box(
        "Low cleaning head",
        (0.142, 0, 0.0411),
        (0.10414, 0.23876, 0.0762),
        white,
        0.022,
    )
    box("Head floor lip", (0.188, 0, 0.009), (0.008, 0.207, 0.006), rubber, 0.002)
    robot = bpy.data.objects.new("Robot heading", None)
    bpy.context.collection.objects.link(robot)
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    for obj in meshes:
        obj.parent = robot
    return robot, meshes


def make_shadow_floor():
    """Cycles ray-traced ambient occlusion, stored as a separate black alpha tile."""
    surface = bpy.data.materials.new("Contact occlusion")
    surface.use_nodes = True
    nodes = surface.node_tree.nodes
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    ao = nodes.new("ShaderNodeAmbientOcclusion")
    ao.inputs["Distance"].default_value = 0.06
    ao.samples = 32
    inverse = nodes.new("ShaderNodeMath")
    inverse.operation = "SUBTRACT"
    inverse.inputs[0].default_value = 1
    strength = nodes.new("ShaderNodeMath")
    strength.operation = "MULTIPLY"
    strength.inputs[1].default_value = 0.35
    transparent = nodes.new("ShaderNodeBsdfTransparent")
    black = nodes.new("ShaderNodeEmission")
    black.inputs["Color"].default_value = (0, 0, 0, 1)
    mix = nodes.new("ShaderNodeMixShader")
    links = surface.node_tree.links
    links.new(ao.outputs["AO"], inverse.inputs[1])
    links.new(inverse.outputs[0], strength.inputs[0])
    links.new(strength.outputs[0], mix.inputs[0])
    links.new(transparent.outputs[0], mix.inputs[1])
    links.new(black.outputs[0], mix.inputs[2])
    links.new(mix.outputs[0], output.inputs["Surface"])
    bpy.ops.mesh.primitive_plane_add(size=2, location=(0, 0, -0.0005))
    floor = bpy.context.object
    floor.name = "Contact shadow receiver"
    floor.data.materials.append(surface)
    return floor


def configure_scene(work, samples):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.cycles.seed = 84
    scene.render.film_transparent = True
    scene.render.resolution_x = scene.render.resolution_y = FRAME * 2
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.world.color = (0.35, 0.35, 0.35)
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    bpy.ops.object.camera_add()
    camera = bpy.context.object
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = FRAME_METERS
    scene.camera = camera
    for name, location, power, size in (
        ("Upper-left softbox", (-0.6, -0.7, 1.0), 55, 0.7),
        ("Soft fill", (0.6, 0.1, 0.5), 9, 0.8),
    ):
        bpy.ops.object.light_add(type="AREA", location=location)
        light = bpy.context.object
        light.name = name
        light.data.energy, light.data.shape, light.data.size = power, "DISK", size
        light.rotation_euler = (-light.location).to_track_quat("-Z", "Y").to_euler()
    scene.use_nodes = True
    nodes = scene.node_tree.nodes
    nodes.clear()
    layers = nodes.new("CompositorNodeRLayers")
    scene.view_layers[0].use_pass_object_index = True
    composite = nodes.new("CompositorNodeComposite")
    scene.node_tree.links.new(layers.outputs["Image"], composite.inputs[0])
    mask = nodes.new("CompositorNodeIDMask")
    mask.index = 1
    mask.use_antialiasing = True
    scene.node_tree.links.new(layers.outputs["IndexOB"], mask.inputs[0])
    alpha = nodes.new("CompositorNodeSetAlpha")
    alpha.inputs["Image"].default_value = (1, 1, 1, 1)
    scene.node_tree.links.new(mask.outputs["Alpha"], alpha.inputs["Alpha"])
    output = nodes.new("CompositorNodeOutputFile")
    output.base_path = str(work)
    output.format.file_format, output.format.color_mode = "PNG", "RGBA"
    scene.node_tree.links.new(alpha.outputs[0], output.inputs[0])
    return scene, camera, output


def set_view(scene, camera, robot, pitch, screen_angle):
    camera.location = (0, -2 * math.cos(pitch), 2 * math.sin(pitch))
    # Track-to has an ambiguous roll at the pole. This basis keeps +x right
    # and world +y up in the top view, continuously through all three pitches.
    camera.rotation_euler = (math.pi / 2 - pitch, 0, 0)
    robot.rotation_euler.z = math.atan2(
        -math.sin(screen_angle) / math.sin(pitch), math.cos(screen_angle)
    )
    for name, offset in (
        ("Upper-left softbox", (-0.6, 0.8, 1.0)),
        ("Soft fill", (0.6, 0.1, 0.5)),
    ):
        light = bpy.data.objects[name]
        light.location = camera.rotation_euler.to_matrix() @ Vector(offset)
        light.rotation_euler = (-light.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.view_layer.update()


def check_projection(scene, camera, robot, meshes, expected):
    """Check the actual camera, not the frame label or its angle calculation."""
    origin = world_to_camera_view(scene, camera, Vector((0, 0, 0)))
    front = world_to_camera_view(
        scene, camera, robot.matrix_world @ Vector((0.2, 0, 0))
    )
    actual = math.atan2(origin.y - front.y, front.x - origin.x)
    error = math.atan2(math.sin(actual - expected), math.cos(actual - expected))
    if abs(error) > 1e-5 or abs(origin.x - 0.5) + abs(origin.y - 0.5) > 1e-5:
        raise RuntimeError(
            f"Camera heading/ground anchor mismatch: {actual}, {expected}"
        )
    graph = bpy.context.evaluated_depsgraph_get()
    margin = 8 / (FRAME * 2)
    for mesh in meshes:
        evaluated = mesh.evaluated_get(graph)
        for corner in evaluated.bound_box:
            point = world_to_camera_view(
                scene, camera, evaluated.matrix_world @ Vector(corner)
            )
            if not (margin < point.x < 1 - margin and margin < point.y < 1 - margin):
                raise RuntimeError(f"Clipped geometry: {mesh.name}, {tuple(point)}")


PACK = """
import sys
from pathlib import Path
from PIL import Image, ImageFilter
work = Path(sys.argv[1])
atlas = Image.new('RGBA', (4096, 1152))
for pitch in range(3):
    for heading in range(32):
        index = pitch * 32 + heading
        for layer, name in enumerate(('body', 'shadow', 'accent')):
            suffix = '-0001' if name == 'accent' else ''
            with Image.open(work / f'{name}-{index:03d}{suffix}.png') as frame:
                tile = frame.convert('RGBA').resize((128,128), Image.Resampling.LANCZOS)
                alpha = tile.getchannel('A')
                if name == 'shadow':
                    # Remove sub-visible sampling noise in otherwise clear floor.
                    alpha = alpha.point(lambda value: 0 if value < 3 else value)
                    alpha = alpha.filter(ImageFilter.GaussianBlur(0.8))
                # Thirty-two alpha levels preserve soft edges while keeping
                # the lossless alpha stream smaller than the colour image.
                alpha = alpha.point(lambda value: min(255, round(value / 8) * 8))
                tile.putalpha(alpha)
                bounds = alpha.getbbox()
                if bounds is None:
                    raise RuntimeError(f'Empty {name} frame {index}')
                if name != 'shadow' and not all((bounds[0] >= 3, bounds[1] >= 3,
                                                bounds[2] <= 125, bounds[3] <= 125)):
                    raise RuntimeError(f'Clipped {name} frame {index}: {bounds}')
                if name == 'shadow':
                    corners = [(0,0,8,8),(120,0,128,8),(0,120,8,128),(120,120,128,128)]
                    if any(alpha.crop(corner).getextrema()[1] for corner in corners):
                        raise RuntimeError(f'Shadow outside contact: {index}')
                atlas.paste(tile, (heading*128, (layer*3+pitch)*128))
atlas.save(work / 'atlas.png')
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work-dir", type=Path)
    parser.add_argument("--samples", type=int, default=48)
    parser.add_argument("--preview", action="store_true")
    parser.add_argument("--pack-only", action="store_true")
    parser.add_argument("--python", default=str(ROOT / ".venv/bin/python"))
    args = parser.parse_args(
        sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    )
    encoder = shutil.which("cwebp")
    if not encoder:
        raise RuntimeError("Install libwebp's cwebp before building the atlas")
    with tempfile.TemporaryDirectory(prefix="matic-robot-") as temporary:
        work = args.work_dir or Path(temporary)
        work.mkdir(parents=True, exist_ok=True)
        if not args.pack_only:
            scene, camera, mask_output = configure_scene(work, args.samples)
            robot, meshes = make_robot()
            floor = make_shadow_floor()
            for degrees in PITCHES:
                for heading in range(HEADINGS):
                    expected = heading * math.tau / HEADINGS
                    set_view(scene, camera, robot, math.radians(degrees), expected)
                    check_projection(scene, camera, robot, meshes, expected)
            print(
                "Validated projection, ground anchor and margin for all 96 frames",
                flush=True,
            )
            for pitch_index, degrees in enumerate(PITCHES):
                pitch = math.radians(degrees)
                for heading in [0, 4] if args.preview else range(HEADINGS):
                    index = pitch_index * HEADINGS + heading
                    screen_angle = heading * math.tau / HEADINGS
                    # Uniform screen headings: undo the pitch foreshortening.
                    # Index 0 faces screen +x; positive indices turn clockwise.
                    set_view(scene, camera, robot, pitch, screen_angle)
                    floor.hide_render = True
                    for mesh in meshes:
                        mesh.visible_camera = True
                    scene.use_nodes = True
                    mask_output.file_slots[0].path = f"accent-{index:03d}-"
                    scene.render.filepath = str(work / f"body-{index:03d}.png")
                    bpy.ops.render.render(write_still=True)
                    scene.use_nodes = False
                    floor.hide_render = False
                    for mesh in meshes:
                        mesh.visible_camera = False
                    scene.render.filepath = str(work / f"shadow-{index:03d}.png")
                    bpy.ops.render.render(write_still=True)
                    print(f"ROBOT_FRAME {index + 1}/96 pitch={degrees}", flush=True)
        if args.preview:
            print(f"Preview layers: {work}")
            return
        subprocess.run([args.python, "-c", PACK, str(work)], check=True)
        atlas = work / "robot-atlas.webp"
        subprocess.run(
            [
                encoder,
                "-quiet",
                "-q",
                "85",
                "-alpha_q",
                "80",
                "-m",
                "6",
                "-sharp_yuv",
                str(work / "atlas.png"),
                "-o",
                str(atlas),
            ],
            check=True,
        )
        if atlas.stat().st_size >= 250_000:
            raise RuntimeError(f"Atlas exceeds 250 KB: {atlas.stat().st_size} bytes")
        OUTPUT.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(atlas, OUTPUT / atlas.name)
        metadata = {
            "frameSize": FRAME,
            "headings": HEADINGS,
            "headingStep": 11.25,
            "pitches": PITCHES,
            "columns": HEADINGS,
            "layers": {"body": 0, "shadow": 3, "accent": 6},
            "frameMeters": FRAME_METERS,
            "lengthMeters": LENGTH_METERS,
            "anchor": [0.5, 0.5],
            "headingDirection": "clockwise-screen",
            "renderer": (
                f"Blender {bpy.app.version_string}, Cycles, {args.samples} samples"
            ),
        }
        (OUTPUT / "robot-atlas.json").write_text(json.dumps(metadata, indent=2) + "\n")
        print(f"Atlas: {atlas.stat().st_size} bytes; {OUTPUT / atlas.name}")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        # Blender otherwise prints Python exceptions and exits successfully.
        sys.exit(1)
