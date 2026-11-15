// One WebGL renderer shared by every lesson; each lesson gets a fresh scene with floor grid and lights.
import * as THREE from '../../vendor/three/three.module.min.js';
import { OrbitControls } from '../../vendor/three/OrbitControls.js';
import { ease } from './math.js';

export { THREE };

let haloTex = null;
export function haloTexture() {
    if (haloTex) return haloTex;
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(255,255,255,.55)');
    grd.addColorStop(0.6, 'rgba(255,255,255,.12)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    haloTex = new THREE.CanvasTexture(c);
    haloTex.colorSpace = THREE.SRGBColorSpace;
    return haloTex;
}

/** Additive glow sprite. */
export function halo(color, size = 1, opacity = 0.9) {
    const m = new THREE.SpriteMaterial({ map: haloTexture(), color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
    const s = new THREE.Sprite(m); s.scale.setScalar(size);
    return s;
}

export class Scene3D {
    constructor(container) {
        this.container = container;
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
        this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.localClippingEnabled = true;
        container.appendChild(this.renderer.domElement);
        this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 200);
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        this.controls.minDistance = 2.5;
        this.controls.maxDistance = 40;
        this.controls.addEventListener('start', () => { this.orbited = true; this.tween = null; });
        this.ripples = [];
        this.handlers = {};
        this.raycaster = new THREE.Raycaster();
        this._ro = new ResizeObserver(() => this.resize());
        this._ro.observe(container);
        this._bind();
        this.newScene({});
    }

    resize() {
        const r = this.container.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return;
        this.renderer.setSize(r.width, r.height, false);
        this.renderer.domElement.style.width = '100%';
        this.renderer.domElement.style.height = '100%';
        this.camera.aspect = r.width / r.height;
        this.camera.updateProjectionMatrix();
        this.w = r.width; this.h = r.height;
    }

    newScene({ grid = true, size = 6, camera = [5.2, 4.2, 6.2], target = [0, 0.6, 0] } = {}) {
        if (this.scene) this.disposeScene();
        const s = new THREE.Scene();
        this.scene = s;
        s.add(new THREE.HemisphereLight(0xdbeafe, 0x1e1b4b, 1.2));
        const d = new THREE.DirectionalLight(0xffffff, 1.6); d.position.set(4, 9, 6); s.add(d);
        const d2 = new THREE.DirectionalLight(0x99ddff, 0.5); d2.position.set(-6, 3, -4); s.add(d2);
        if (grid) {
            this.grid = new THREE.GridHelper(size, size * 4, 0x64748b, 0x64748b);
            this.grid.material.transparent = true;
            this.grid.material.depthWrite = false;
            s.add(this.grid);
        } else this.grid = null;
        this.applyTheme();
        this.camera.position.set(...camera);
        this.controls.target.set(...target);
        this.controls.update();
        this.orbited = false;
        this.tween = null;
        this.ripples = [];
        return s;
    }

    applyTheme() {
        const light = document.documentElement.getAttribute('data-theme') === 'light';
        this.light = light;
        if (this.grid) {
            this.grid.material.color.set(light ? 0x94a3b8 : 0x475569);
            this.grid.material.opacity = light ? 0.55 : 0.45;
        }
    }

    disposeScene() {
        this.scene.traverse((o) => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
        });
    }

    tweenCamera(pos, target, ms = 1100) {
        this.tween = {
            p0: this.camera.position.clone(), p1: new THREE.Vector3(...pos),
            t0: this.controls.target.clone(), t1: new THREE.Vector3(...target),
            start: performance.now(), ms,
        };
    }

    ray(clientX, clientY) {
        const r = this.renderer.domElement.getBoundingClientRect();
        const v = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
        this.raycaster.setFromCamera(v, this.camera);
        return this.raycaster;
    }
    pick(objects, e) { return this.ray(e.clientX, e.clientY).intersectObjects(objects, false); }

    /** Screen position (CSS px, relative to the container) of a world point. */
    project(v) {
        const p = v.clone().project(this.camera);
        return { x: (p.x * 0.5 + 0.5) * this.w, y: (-p.y * 0.5 + 0.5) * this.h, behind: p.z > 1 };
    }

    on(ev, fn) { (this.handlers[ev] ||= []).push(fn); }
    emit(ev, a) { let r; for (const f of this.handlers[ev] || []) { const v = f(a); if (v) r = v; } return r; }

    _bind() {
        const el = this.container;
        let down = null;
        // capture phase so lessons can grab an object before OrbitControls starts rotating
        el.addEventListener('pointerdown', (e) => {
            if (e.button > 0) return;
            down = { x: e.clientX, y: e.clientY, t: performance.now(), captured: !!this.emit('down', e) };
            if (down.captured) { this.controls.enabled = false; el.setPointerCapture(e.pointerId); }
        }, true);
        el.addEventListener('pointermove', (e) => {
            if (down && down.captured) this.emit('drag', e);
            else this.emit('hover', e);
        });
        const up = (e) => {
            if (!down) return;
            if (down.captured) { this.emit('up', e); this.controls.enabled = true; }
            else if (Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5 && performance.now() - down.t < 400) this.emit('click', e);
            down = null;
        };
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
        el.addEventListener('pointerleave', () => this.emit('leave'));
    }

    addRipple(pos, color, normal) {
        const g = new THREE.RingGeometry(0.06, 0.1, 48);
        const m = new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
        const mesh = new THREE.Mesh(g, m);
        mesh.position.copy(pos);
        if (normal) mesh.lookAt(pos.clone().add(normal)); else mesh.rotation.x = -Math.PI / 2;
        this.scene.add(mesh);
        this.ripples.push({ mesh, t0: performance.now() });
    }

    frame() {
        const now = performance.now();
        if (this.tween) {
            const t = Math.min(1, (now - this.tween.start) / this.tween.ms), e = ease(t);
            this.camera.position.lerpVectors(this.tween.p0, this.tween.p1, e);
            this.controls.target.lerpVectors(this.tween.t0, this.tween.t1, e);
            if (t >= 1) this.tween = null;
        }
        this.ripples = this.ripples.filter((r) => {
            const t = (now - r.t0) / 800;
            if (t >= 1) { this.scene.remove(r.mesh); r.mesh.geometry.dispose(); r.mesh.material.dispose(); return false; }
            r.mesh.scale.setScalar(1 + t * 5);
            r.mesh.material.opacity = 1 - t;
            return true;
        });
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }
}
