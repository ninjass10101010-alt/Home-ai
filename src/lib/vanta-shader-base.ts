import * as THREE from "three";

const win = typeof window === "object";

export interface ShaderOptions {
  el: HTMLElement;
  THREE?: typeof THREE;
  mouseControls?: boolean;
  touchControls?: boolean;
  gyroControls?: boolean;
  minHeight?: number;
  minWidth?: number;
  scale?: number;
  scaleMobile?: number;
  speed?: number;
  forceAnimate?: boolean;
  backgroundColor?: number;
  backgroundAlpha?: number;
  mouseEase?: boolean;
  pixelated?: boolean;
  texturePath?: string;
  [key: string]: unknown;
}

export abstract class ShaderBase {
  options: ShaderOptions;
  el: HTMLElement;
  width = 0;
  height = 0;
  scale = 1;
  renderer!: THREE.WebGLRenderer;
  scene!: THREE.Scene;
  camera!: THREE.Camera;
  uniforms: Record<string, THREE.IUniform> = {};
  t = 0;
  t2 = 0;
  prevNow = 0;
  mouseX = 0;
  mouseY = 0;
  mouseEaseX = 0;
  mouseEaseY = 0;
  req = 0;
  private _THREE: typeof THREE;
  private _boundResize: () => void;
  private _boundMouseMove: (e: MouseEvent | Event) => void;
  private _boundTouch: (e: TouchEvent) => void;
  private _boundGyro: (e: DeviceOrientationEvent) => void;
  private _boundLoop: () => void;

  abstract fragmentShader: string;
  vertexShader?: string;
  valuesChanger?: () => void;

  constructor(userOptions: ShaderOptions) {
    if (!win) {
      throw new Error("Vanta shader requires a browser environment");
    }

    this._THREE = userOptions.THREE ?? THREE;

    this._boundResize = this.resize.bind(this);
    this._boundMouseMove = this.windowMouseMoveWrapper.bind(this);
    this._boundTouch = this.windowTouchWrapper.bind(this);
    this._boundGyro = this.windowGyroWrapper.bind(this);
    this._boundLoop = this.animationLoop.bind(this);

    const defaultOptions = this.getDefaultOptions?.() ?? (this as any).defaultOptions ?? {};

    this.options = {
      mouseControls: true,
      touchControls: true,
      gyroControls: false,
      minHeight: 200,
      minWidth: 200,
      scale: 1,
      scaleMobile: 1,
      ...defaultOptions,
      ...userOptions,
    };

    const el = this.options.el;
    if (!el) throw new Error('Instance needs "el" param!');
    this.el = el;

    this.prepareEl();
    this.initRenderer();
    this.setSize();

    try {
      this.init();
    } catch (e) {
      console.error("[Vanta] Init error", e);
      if (this.renderer?.domElement) {
        this.el.removeChild(this.renderer.domElement);
      }
      return;
    }

    this.initMouse();
    this.resize();
    this.animationLoop();

    const ad = window.addEventListener;
    ad("resize", this._boundResize);
    window.requestAnimationFrame(() => this.resize());

    if (this.options.mouseControls) {
      ad("scroll", this._boundMouseMove);
      ad("mousemove", this._boundMouseMove);
    }
    if (this.options.touchControls) {
      ad("touchstart", this._boundTouch);
      ad("touchmove", this._boundTouch);
    }
    if (this.options.gyroControls) {
      ad("deviceorientation", this._boundGyro);
    }
  }

  setOptions(userOptions: Partial<ShaderOptions> = {}) {
    Object.assign(this.options, userOptions);
    this.triggerMouseMove();
    this.updateUniforms();
  }

  private prepareEl() {
    const el = this.el;
    for (let i = 0; i < el.childNodes.length; i++) {
      const n = el.childNodes[i];
      if (n.nodeType === Node.TEXT_NODE && n.textContent?.trim()) {
        const s = document.createElement("span");
        s.textContent = n.textContent;
        n.parentElement!.insertBefore(s, n);
        n.remove();
      }
    }
    for (let i = 0; i < el.children.length; i++) {
      const child = el.children[i] as HTMLElement;
      if (getComputedStyle(child).position === "static") {
        child.style.position = "relative";
      }
      if (getComputedStyle(child).zIndex === "auto") {
        child.style.zIndex = "1";
      }
    }
    if (getComputedStyle(el).position === "static") {
      el.style.position = "relative";
    }
  }

  private initRenderer() {
    this.renderer = new this._THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
    });
    this.el.appendChild(this.renderer.domElement);
    Object.assign(this.renderer.domElement.style, {
      position: "absolute",
      zIndex: "0",
      top: "0",
      left: "0",
      background: "",
    });
    if (this.options.backgroundAlpha == null) {
      this.options.backgroundAlpha = 1;
    }
    this.scene = new this._THREE.Scene();
  }

  getCanvasElement() {
    return this.renderer?.domElement;
  }

  getCanvasRect() {
    const canvas = this.getCanvasElement();
    if (!canvas) return null;
    return canvas.getBoundingClientRect();
  }

  private windowMouseMoveWrapper(e: MouseEvent | Event) {
    if (!("clientX" in e)) return;
    const rect = this.getCanvasRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (x >= 0 && y >= 0 && x <= rect.width && y <= rect.height) {
      this.mouseX = x;
      this.mouseY = y;
      if (!this.options.mouseEase) this.triggerMouseMove(x, y);
    }
  }

  private windowTouchWrapper(e: TouchEvent) {
    const rect = this.getCanvasRect();
    if (!rect) return;
    if (e.touches.length === 1) {
      const x = e.touches[0].clientX - rect.left;
      const y = e.touches[0].clientY - rect.top;
      if (x >= 0 && y >= 0 && x <= rect.width && y <= rect.height) {
        this.mouseX = x;
        this.mouseY = y;
        if (!this.options.mouseEase) this.triggerMouseMove(x, y);
      }
    }
  }

  private windowGyroWrapper(e: DeviceOrientationEvent) {
    const rect = this.getCanvasRect();
    if (!rect) return;
    const x = Math.round((e.alpha ?? 0) * 2) - rect.left;
    const y = Math.round((e.beta ?? 0) * 2) - rect.top;
    if (x >= 0 && y >= 0 && x <= rect.width && y <= rect.height) {
      this.mouseX = x;
      this.mouseY = y;
      if (!this.options.mouseEase) this.triggerMouseMove(x, y);
    }
  }

  triggerMouseMove(x?: number, y?: number) {
    if (x === undefined && y === undefined) {
      if (this.options.mouseEase) {
        x = this.mouseEaseX;
        y = this.mouseEaseY;
      } else {
        x = this.mouseX;
        y = this.mouseY;
      }
    }
    if (this.uniforms.iMouse) {
      this.uniforms.iMouse.value.x = (x ?? 0) / this.scale;
      this.uniforms.iMouse.value.y = (y ?? 0) / this.scale;
    }
    const xNorm = (x ?? 0) / this.width;
    const yNorm = (y ?? 0) / this.height;
    this.onMouseMove?.(xNorm, yNorm);
  }

  onMouseMove?(_x: number, _y: number): void;

  setSize() {
    this.scale = 1;
    if (mobileCheck() && this.options.scaleMobile) {
      this.scale = this.options.scaleMobile;
    } else if (this.options.scale) {
      this.scale = this.options.scale;
    }
    this.width = Math.max(this.el.offsetWidth, this.options.minWidth ?? 200);
    this.height = Math.max(this.el.offsetHeight, this.options.minHeight ?? 200);
  }

  private initMouse() {
    if (
      (!this.mouseX && !this.mouseY) ||
      (this.mouseX === (this.options.minWidth ?? 200) / 2 &&
        this.mouseY === (this.options.minHeight ?? 200) / 2)
    ) {
      this.mouseX = this.width / 2;
      this.mouseY = this.height / 2;
      this.triggerMouseMove(this.mouseX, this.mouseY);
    }
  }

  resize() {
    this.setSize();
    if (this.renderer) {
      this.renderer.setSize(this.width, this.height);
      this.renderer.setPixelRatio(window.devicePixelRatio / this.scale);
    }
    if (this.uniforms.iResolution) {
      this.uniforms.iResolution.value.x = this.width / this.scale;
      this.uniforms.iResolution.value.y = this.height / this.scale;
    }
    if (this.uniforms.iDpr) {
      this.uniforms.iDpr.value = window.devicePixelRatio || 1;
    }
    this.onResize?.();
  }

  onResize?(): void;

  private isOnScreen() {
    const elHeight = this.el.offsetHeight;
    const elRect = this.el.getBoundingClientRect();
    const scrollTop =
      window.pageYOffset ||
      (document.documentElement || document.body.parentNode || document.body)
        .scrollTop;
    const offsetTop = elRect.top + scrollTop;
    const minScrollTop = offsetTop - window.innerHeight;
    const maxScrollTop = offsetTop + elHeight;
    return minScrollTop <= scrollTop && scrollTop <= maxScrollTop;
  }

  private animationLoop() {
    this.t = this.t || 0;
    this.t2 = this.t2 || 0;

    const now = performance.now();
    if (this.prevNow) {
      let elapsedTime = (now - this.prevNow) / (1000 / 60);
      elapsedTime = Math.max(0.2, Math.min(elapsedTime, 5));
      this.t += elapsedTime;
      this.t2 += (this.options.speed || 1) * elapsedTime;
      if (this.uniforms.iTime) {
        this.uniforms.iTime.value = this.t2 * 0.016667;
      }
    }
    this.prevNow = now;

    if (this.options.mouseEase) {
      this.mouseEaseX = this.mouseEaseX || this.mouseX || 0;
      this.mouseEaseY = this.mouseEaseY || this.mouseY || 0;
      if (
        Math.abs(this.mouseEaseX - this.mouseX) +
          Math.abs(this.mouseEaseY - this.mouseY) >
        0.1
      ) {
        this.mouseEaseX += (this.mouseX - this.mouseEaseX) * 0.05;
        this.mouseEaseY += (this.mouseY - this.mouseEaseY) * 0.05;
        this.triggerMouseMove(this.mouseEaseX, this.mouseEaseY);
      }
    }

    if (this.isOnScreen() || this.options.forceAnimate) {
      this.onUpdate?.();
      if (this.scene && this.camera) {
        this.renderer.render(this.scene, this.camera);
        if (this.options.backgroundColor != null) {
          this.renderer.setClearColor(
            this.options.backgroundColor,
            this.options.backgroundAlpha ?? 1,
          );
        }
      }
      this.afterRender?.();
    }

    this.req = window.requestAnimationFrame(this._boundLoop);
  }

  onUpdate?(): void;
  afterRender?(): void;

  init() {
    this.uniforms = {
      iTime: { value: 1.0 },
      iResolution: {
        value: new this._THREE.Vector2(1, 1),
      },
      iDpr: {
        value: window.devicePixelRatio || 1,
      },
      iMouse: {
        value: new this._THREE.Vector2(this.mouseX || 0, this.mouseY || 0),
      },
    } as Record<string, THREE.IUniform>;

    if (this.fragmentShader) {
      this.initBasicShader();
    }
  }

  initBasicShader(fragmentShader?: string, vertexShader?: string) {
    const frag = fragmentShader ?? this.fragmentShader;
    const vert =
      vertexShader ??
      this.vertexShader ??
      "varying vec2 vUv;\nvoid main() {\n  vUv = uv;\n  gl_Position = vec4(position, 1.0);\n}";

    this.updateUniforms();
    this.valuesChanger?.();

    const material = new this._THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
    });

    const texPath = this.options.texturePath;
    if (texPath) {
      this.uniforms.iTex = {
        value: new this._THREE.TextureLoader().load(texPath),
      };
    }

    const mesh = new this._THREE.Mesh(
      new this._THREE.PlaneGeometry(2, 2),
      material,
    );
    this.scene.add(mesh);
    this.camera = new this._THREE.Camera();
    this.camera.position.z = 1;
  }

  updateUniforms() {
    const newUniforms: Record<string, THREE.IUniform> = {};
    for (const k in this.options) {
      const v = this.options[k];
      if (k.toLowerCase().includes("color") && typeof v === "number") {
        newUniforms[k] = {
          value: new this._THREE.Color(v).toArray(),
        };
      } else if (typeof v === "number") {
        newUniforms[k] = { value: v };
      }
    }
    Object.assign(this.uniforms, newUniforms);
  }

  destroy() {
    this.onDestroy?.();
    const rm = window.removeEventListener;
    rm("touchstart", this._boundTouch);
    rm("touchmove", this._boundTouch);
    rm("scroll", this._boundMouseMove);
    rm("mousemove", this._boundMouseMove);
    rm("deviceorientation", this._boundGyro);
    rm("resize", this._boundResize);
    window.cancelAnimationFrame(this.req);

    if (this.renderer) {
      this.renderer.dispose();
      if (this.renderer.domElement) {
        this.el.removeChild(this.renderer.domElement);
      }
    }
  }

  onDestroy?(): void;

  getDefaultOptions?(): Partial<ShaderOptions>;
}

function mobileCheck() {
  return /Android|iPhone|iPad|iPod|webOS/i.test(navigator.userAgent);
}
