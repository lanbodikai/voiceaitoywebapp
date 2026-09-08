import { useEffect, useRef } from 'react'
import { IcosahedronGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, ShaderMaterial, TorusGeometry, WebGLRenderer, type Material } from 'three'

export type OrbState = 'idle' | 'speaking' | 'listening' | 'thinking' | 'paused'

const energyForState: Record<OrbState, number> = {
  idle: 0.24,
  speaking: 0.68,
  listening: 1,
  thinking: 0.45,
  paused: 0.05,
}

/** A lightweight, self-contained Three.js presence that remains usable without WebGL. */
export function ConversationOrb({ state, className = '' }: { state: OrbState; className?: string }) {
  const mount = useRef<HTMLDivElement>(null)
  const currentState = useRef(state)
  useEffect(() => { currentState.current = state }, [state])

  useEffect(() => {
    const host = mount.current
    if (!host) return

    const renderer = new WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    renderer.setClearColor(0x000000, 0)
    host.appendChild(renderer.domElement)

    const scene = new Scene()
    const camera = new PerspectiveCamera(32, 1, 0.1, 100)
    camera.position.z = 5.1

    const uniforms = {
      time: { value: 0 },
      energy: { value: energyForState[currentState.current] },
    }
    const orb = new Mesh(
      new IcosahedronGeometry(1.38, 5),
      new ShaderMaterial({
        transparent: true,
        uniforms,
        vertexShader: `
          uniform float time;
          uniform float energy;
          varying vec3 vNormal;
          varying vec3 vPosition;
          void main() {
            float ripple = sin(position.y * 4.0 + time * 1.25) * 0.045;
            ripple += sin(position.x * 5.0 - time * 0.88) * 0.028;
            ripple += sin(position.z * 4.0 + time * 1.6) * 0.022;
            vec3 displaced = position + normal * ripple * (0.65 + energy * 1.45);
            vNormal = normalize(normalMatrix * normal);
            vPosition = displaced;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
          }
        `,
        fragmentShader: `
          uniform float time;
          uniform float energy;
          varying vec3 vNormal;
          varying vec3 vPosition;
          void main() {
            vec3 peach = vec3(1.0, 0.49, 0.52);
            vec3 lilac = vec3(0.48, 0.38, 0.95);
            vec3 pink = vec3(1.0, 0.20, 0.57);
            float sweep = sin(vPosition.y * 1.8 + vPosition.x * 1.35 + time * 0.32) * 0.5 + 0.5;
            vec3 color = mix(peach, lilac, sweep);
            color = mix(color, pink, pow(max(0.0, vNormal.z), 2.0) * 0.33);
            float rim = pow(1.0 - abs(vNormal.z), 2.2);
            color += rim * (0.2 + energy * 0.28);
            gl_FragColor = vec4(color, 0.9);
          }
        `,
      }),
    )
    scene.add(orb)

    const halo = new Mesh(
      new TorusGeometry(1.68, 0.018, 12, 160),
      new MeshBasicMaterial({ color: 0xd898ff, transparent: true, opacity: 0.46 }),
    )
    halo.rotation.x = 0.42
    halo.rotation.y = -0.27
    scene.add(halo)

    const resize = () => {
      const { width, height } = host.getBoundingClientRect()
      renderer.setSize(width, height, false)
      camera.aspect = width / Math.max(height, 1)
      camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()

    let frame = 0
    const startedAt = performance.now()
    const render = (now: number) => {
      const time = (now - startedAt) / 1000
      const targetEnergy = energyForState[currentState.current]
      uniforms.energy.value += (targetEnergy - uniforms.energy.value) * 0.075
      uniforms.time.value = time
      orb.rotation.y = time * (0.08 + uniforms.energy.value * 0.1)
      orb.rotation.x = Math.sin(time * 0.45) * 0.12
      halo.rotation.z = time * (0.08 + uniforms.energy.value * 0.14)
      halo.scale.setScalar(1 + Math.sin(time * 2.2) * uniforms.energy.value * 0.035)
      renderer.render(scene, camera)
      frame = requestAnimationFrame(render)
    }
    frame = requestAnimationFrame(render)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      orb.geometry.dispose()
      ;(orb.material as Material).dispose()
      halo.geometry.dispose()
      ;(halo.material as Material).dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  return <div ref={mount} className={`three-orb ${className}`} aria-hidden="true"><div className="three-orb-fallback" /></div>
}
