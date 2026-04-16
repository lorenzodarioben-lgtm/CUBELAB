import { useServices, useStudio, useUi } from '../../app/context';
import { Dialog, Kbd } from '../ui/primitives';

export function HelpDialog() {
  const { ui } = useServices();
  const open = useUi((s) => s.helpOpen);
  const keyMap = useStudio((s) => s.settings.keyMap);

  return (
    <Dialog open={open} onClose={() => ui.setState({ helpOpen: false })} eyebrow="Field guide" title="How CUBELAB works" className="help">
      <div className="help-grid">
        <section>
          <h3 className="eyebrow">Gestures</h3>
          <ul className="help-list">
            <li>
              <strong>Twist</strong> — press on a sticker and push it along its row or column. The outer layer under your finger follows; release past
              ~25° (or flick) to commit, otherwise it springs back. The move you are about to make is shown beside the pointer.
            </li>
            <li>
              <strong>Orbit</strong> — drag the empty background. Right-drag or Shift-drag also orbits from anywhere, including over the cube.
            </li>
            <li>
              <strong>Zoom</strong> — scroll, or pinch with two fingers (two fingers also orbit).
            </li>
            <li>
              Middle layers are not turnable: CUBELAB only produces the six outer-face moves, so every turn is notation the timer and solver
              understand. On phones, the Twist / Orbit switch makes single-finger drags unambiguous.
            </li>
          </ul>
        </section>

        <section>
          <h3 className="eyebrow">Notation</h3>
          <p>
            <strong>U D L R F B</strong> turn the Up, Down, Left, Right, Front and Back faces clockwise <em>as seen looking at that face</em>.
            <strong> '</strong> is counter-clockwise, <strong>2</strong> a half turn. Orbiting the camera never changes what a letter means: white is U,
            green is F.
          </p>
          <p className="muted">Turn counts use HTM (each U, U' or U2 = 1) and QTM (U2 = 2).</p>
        </section>

        <section>
          <h3 className="eyebrow">Timer</h3>
          <ul className="help-list">
            <li>
              <strong>Casual</strong> (default): after New Scramble the clock starts on your first turn and stops on the turn that solves the cube.
            </li>
            <li>
              <strong>Spacebar</strong>: optional 15 s inspection, then hold Space (or press and hold the clock) for 0.3 s until it turns green and
              release to start. Under 15 s of inspection is clean, 15 s or more adds +2, 17 s or more is DNF — a training mirror of current WCA
              practice, not an official timer.
            </li>
            <li>Undo/redo during an attempt saves it as practice. Auto Solve ends the attempt unrecorded. Only clean solves count toward PB, ao5, ao12.</li>
          </ul>
        </section>

        <section>
          <h3 className="eyebrow">Keyboard</h3>
          <table className="key-table">
            <tbody>
              {keyMap === 'faces' ? (
                <tr>
                  <td>
                    <Kbd>U</Kbd> <Kbd>D</Kbd> <Kbd>L</Kbd> <Kbd>R</Kbd> <Kbd>F</Kbd> <Kbd>B</Kbd>
                  </td>
                  <td>Turn clockwise · with <Kbd>Shift</Kbd> counter-clockwise</td>
                </tr>
              ) : (
                <tr>
                  <td>
                    <Kbd>I</Kbd>/<Kbd>K</Kbd> R · <Kbd>J</Kbd>/<Kbd>F</Kbd> U · <Kbd>H</Kbd>/<Kbd>G</Kbd> F · <Kbd>D</Kbd>/<Kbd>E</Kbd> L ·{' '}
                    <Kbd>S</Kbd>/<Kbd>L</Kbd> D · <Kbd>W</Kbd>/<Kbd>O</Kbd> B
                  </td>
                  <td>Speed layout (clockwise / counter-clockwise)</td>
                </tr>
              )}
              <tr>
                <td>
                  <Kbd>N</Kbd>
                </td>
                <td>New Scramble</td>
              </tr>
              <tr>
                <td>
                  <Kbd>A</Kbd>
                </td>
                <td>Auto Solve</td>
              </tr>
              <tr>
                <td>
                  <Kbd>P</Kbd> · <Kbd>,</Kbd> <Kbd>.</Kbd>
                </td>
                <td>Play / pause solution · step back / forward</td>
              </tr>
              <tr>
                <td>
                  <Kbd>Ctrl</Kbd>+<Kbd>Z</Kbd> · <Kbd>Ctrl</Kbd>+<Kbd>Shift</Kbd>+<Kbd>Z</Kbd>
                </td>
                <td>Undo · redo</td>
              </tr>
              <tr>
                <td>
                  <Kbd>Space</Kbd>
                </td>
                <td>Spacebar timer: inspect / hold to arm / stop (DNF)</td>
              </tr>
              <tr>
                <td>
                  <Kbd>←</Kbd> <Kbd>→</Kbd> <Kbd>↑</Kbd> <Kbd>↓</Kbd> · <Kbd>C</Kbd>
                </td>
                <td>Orbit camera · reset camera</td>
              </tr>
              <tr>
                <td>
                  <Kbd>Z</Kbd> · <Kbd>M</Kbd> · <Kbd>?</Kbd> · <Kbd>Esc</Kbd>
                </td>
                <td>Zen mode · move pad · this guide · close / cancel</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>
      <p className="help-footnote muted">
        Scrambles are random-state (uniformly random legal positions) and Auto Solve computes a two-phase solution for whatever state the cube is
        in, verifying it before playing. Everything runs locally; nothing is sent anywhere.
      </p>
    </Dialog>
  );
}
