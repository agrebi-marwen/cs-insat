// api/_lib/drivers.js - "One test per run" drivers.
//
// A problem in single-test mode is still judged with ONE Piston request: a
// small driver is sent with the submission. It reads every test from stdin,
// runs the solution once per test in a fresh process / fresh classes (so no
// state leaks between tests), and prints one framed block per test:
//
//   @@T <index> <status> <exit_code> <cpu_ms> <wall_ms> <rss_kb> <output_bytes>\n
//   <exactly output_bytes bytes of the solution's stdout>\n
//   ...
//   @@END <reason>\n
//
// status: OK | TLE | MLE | RE. The judge compares outputs (OK -> AC or WA).
// The driver stops at the first TLE / MLE / RE, or when the time budget for
// the whole run is used up (reason "budget").
//
// Input on stdin:   <count>\n  then per test: <bytes>\n<raw bytes>
// Arguments:        --pj <time_limit_ms> <memory_limit_mb> <budget_ms>
//
// Sources are kept as strings so Vercel always bundles them with the function.

// C and C++ (the same source compiles as C11 and C++17). Linked next to the
// solution; runs as a constructor before main(). Each child process returns
// from the constructor and runs the solution's main() on one test.
export const RUNNER_C = String.raw`
#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <signal.h>
#include <time.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <sys/resource.h>
#include <sys/time.h>

static long pj_now_ms(void) {
    struct timespec t;
    clock_gettime(CLOCK_MONOTONIC, &t);
    return (long)t.tv_sec * 1000L + t.tv_nsec / 1000000L;
}

static void pj_write_all(int fd, const char *p, size_t n) {
    while (n > 0) {
        ssize_t w = write(fd, p, n);
        if (w <= 0) return;
        p += w;
        n -= (size_t)w;
    }
}

static char *pj_read_fd(int fd, size_t *len, size_t cap) {
    size_t size = 1 << 16, used = 0;
    char *buf = (char *)malloc(size);
    for (;;) {
        if (used == size) {
            if (size >= cap) break;
            size *= 2;
            buf = (char *)realloc(buf, size);
        }
        ssize_t r = read(fd, buf + used, size - used);
        if (r <= 0) break;
        used += (size_t)r;
    }
    *len = used;
    return buf;
}

static void pj_write_file(const char *path, const char *p, size_t n) {
    int fd = open(path, O_WRONLY | O_CREAT | O_TRUNC, 0644);
    if (fd < 0) return;
    pj_write_all(fd, p, n);
    close(fd);
}

__attribute__((constructor)) static void pj_driver(int argc, char **argv, char **envp) {
    (void)envp;
    if (argc < 5 || strcmp(argv[1], "--pj") != 0) return; /* not judged: run normally */
    long tl = atol(argv[2]), mem_kb = atol(argv[3]) * 1024L, budget = atol(argv[4]);
    long wall_limit = tl * 2 + 200;
    long start_all = pj_now_ms();

    size_t total = 0;
    char *in = pj_read_fd(0, &total, (size_t)1 << 30);
    char *p = in, *end = in + total;
    long count = strtol(p, &p, 10);
    const char *reason = "done";

    for (long idx = 1; idx <= count; idx++) {
        if (pj_now_ms() - start_all > budget) { reason = "budget"; break; }
        long n = strtol(p, &p, 10);
        if (p < end && *p == '\n') p++;
        if (n < 0 || p + n > end) { reason = "bad-input"; break; }
        pj_write_file("/tmp/pj_in", p, (size_t)n);
        p += n;

        pid_t pid = fork();
        if (pid == 0) {
            int fd = open("/tmp/pj_in", O_RDONLY);
            dup2(fd, 0); close(fd);
            fd = open("/tmp/pj_out", O_WRONLY | O_CREAT | O_TRUNC, 0644);
            dup2(fd, 1); close(fd);
            fd = open("/dev/null", O_WRONLY);
            dup2(fd, 2); close(fd);
            struct rlimit cpu;
            cpu.rlim_cur = cpu.rlim_max = (rlim_t)(tl / 1000 + 2);
            setrlimit(RLIMIT_CPU, &cpu);
            free(in);
            return; /* run the solution's main() on this test */
        }

        long t0 = pj_now_ms();
        int st = 0, timed_out = 0;
        struct rusage ru;
        memset(&ru, 0, sizeof ru);
        for (;;) {
            pid_t r = wait4(pid, &st, WNOHANG, &ru);
            if (r == pid) break;
            if (pj_now_ms() - t0 > wall_limit) {
                kill(pid, SIGKILL);
                wait4(pid, &st, 0, &ru);
                timed_out = 1;
                break;
            }
            usleep(500);
        }
        long wall = pj_now_ms() - t0;
        long cpu_ms = ru.ru_utime.tv_sec * 1000L + ru.ru_utime.tv_usec / 1000L
                    + ru.ru_stime.tv_sec * 1000L + ru.ru_stime.tv_usec / 1000L;
        long rss = ru.ru_maxrss;
        int code = WIFEXITED(st) ? WEXITSTATUS(st) : -1;

        const char *status = "OK";
        if (timed_out || cpu_ms > tl) status = "TLE";
        else if (WIFSIGNALED(st)) {
            int sig = WTERMSIG(st);
            if (sig == SIGXCPU) status = "TLE";
            else if (sig == SIGKILL && rss >= mem_kb * 9 / 10) status = "MLE";
            else status = "RE";
            code = 128 + sig;
        } else if (code != 0) status = "RE";
        else if (rss > mem_kb) status = "MLE";

        int ofd = open("/tmp/pj_out", O_RDONLY);
        size_t olen = 0;
        char *out = ofd >= 0 ? pj_read_fd(ofd, &olen, (size_t)64 << 20) : (char *)malloc(1);
        if (ofd >= 0) close(ofd);

        char head[256];
        int hl = snprintf(head, sizeof head, "@@T %ld %s %d %ld %ld %ld %lu\n",
                          idx, status, code, cpu_ms, wall, rss, (unsigned long)olen);
        pj_write_all(1, head, (size_t)hl);
        pj_write_all(1, out, olen);
        pj_write_all(1, "\n", 1);
        free(out);
        if (strcmp(status, "OK") != 0) { reason = "failed"; break; }
    }

    char tail[64];
    int tlen = snprintf(tail, sizeof tail, "@@END %s\n", reason);
    pj_write_all(1, tail, (size_t)tlen);
    _exit(0);
}
`;

// Python: the driver is the entry file; the solution is solution.py, run in a
// fresh forked process per test.
export const DRIVER_PY = String.raw`
import os, sys, time, resource, runpy, signal

def main():
    if len(sys.argv) < 5 or sys.argv[1] != '--pj':
        runpy.run_path('solution.py', run_name='__main__')
        return
    tl, mem_kb, budget = int(sys.argv[2]), int(sys.argv[3]) * 1024, int(sys.argv[4])
    wall_limit = tl * 2 + 200
    # Python has no compile stage: report syntax errors once, as a CE.
    try:
        with open('solution.py', 'rb') as f:
            compile(f.read(), 'solution.py', 'exec')
    except SyntaxError as e:
        msg = ('File "solution.py", line %s\n  %s\nSyntaxError: %s\n' % (e.lineno, (e.text or '').rstrip(), e.msg)).encode()
        sys.stdout.buffer.write(b'@@CE %d\n' % len(msg) + msg + b'\n')
        sys.stdout.buffer.flush()
        return
    data = sys.stdin.buffer.read()
    out = sys.stdout.buffer
    nl = data.index(b'\n')
    count, pos = int(data[:nl]), nl + 1
    start_all = time.monotonic()
    reason = 'done'
    for idx in range(1, count + 1):
        if (time.monotonic() - start_all) * 1000 > budget:
            reason = 'budget'
            break
        nl = data.index(b'\n', pos)
        n = int(data[pos:nl])
        test = data[nl + 1:nl + 1 + n]
        pos = nl + 1 + n
        with open('/tmp/pj_in', 'wb') as f:
            f.write(test)
        out.flush()
        pid = os.fork()
        if pid == 0:
            code = 1
            try:
                fd = os.open('/tmp/pj_in', os.O_RDONLY); os.dup2(fd, 0); os.close(fd)
                fd = os.open('/tmp/pj_out', os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644); os.dup2(fd, 1); os.close(fd)
                fd = os.open(os.devnull, os.O_WRONLY); os.dup2(fd, 2); os.close(fd)
                sec = tl // 1000 + 2
                resource.setrlimit(resource.RLIMIT_CPU, (sec, sec))
                sys.stdin = open(0, 'r', closefd=False)
                sys.stdout = open(1, 'w', closefd=False)
                sys.argv = ['solution.py']
                code = 0
                try:
                    runpy.run_path('solution.py', run_name='__main__')
                except SystemExit as e:
                    code = e.code if isinstance(e.code, int) else (0 if e.code is None else 1)
                except MemoryError:
                    code = 99
                except BaseException:
                    code = 1
                try:
                    sys.stdout.flush()
                except BaseException:
                    code = code or 1
            finally:
                os._exit(code)
        t0 = time.monotonic()
        timed_out = False
        while True:
            r, st, ru = os.wait4(pid, os.WNOHANG)
            if r == pid:
                break
            if (time.monotonic() - t0) * 1000 > wall_limit:
                os.kill(pid, signal.SIGKILL)
                r, st, ru = os.wait4(pid, 0)
                timed_out = True
                break
            time.sleep(0.0005)
        wall = int((time.monotonic() - t0) * 1000)
        cpu = int((ru.ru_utime + ru.ru_stime) * 1000)
        rss = ru.ru_maxrss
        code = os.WEXITSTATUS(st) if os.WIFEXITED(st) else 128 + os.WTERMSIG(st)
        if timed_out or cpu > tl:
            status = 'TLE'
        elif os.WIFSIGNALED(st):
            sig = os.WTERMSIG(st)
            status = 'TLE' if sig == signal.SIGXCPU else ('MLE' if sig == signal.SIGKILL and rss >= mem_kb * 0.9 else 'RE')
        elif code == 99:
            status = 'MLE'
        elif code != 0:
            status = 'RE'
        elif rss > mem_kb:
            status = 'MLE'
        else:
            status = 'OK'
        try:
            with open('/tmp/pj_out', 'rb') as f:
                result = f.read(64 << 20)
        except OSError:
            result = b''
        out.write(b'@@T %d %s %d %d %d %d %d\n' % (idx, status.encode(), code, cpu, wall, rss, len(result)))
        out.write(result)
        out.write(b'\n')
        if status != 'OK':
            reason = 'failed'
            break
    out.write(b'@@END ' + reason.encode() + b'\n')
    out.flush()

main()
`;

// Java: Piston runs a single source file and starts its FIRST class. A
// one-line launcher class is put in front of the solution's first class (on
// the same line, so compile-error line numbers stay correct) and the driver
// is appended at the end. Each test reloads the solution's classes in a new
// class loader (fresh static fields) and runs main() with System.in/out
// redirected; System.exit() is caught instead of ending the JVM.
const JAVA_LAUNCHER = 'class PjLaunch__ { public static void main(String[] a) throws Exception { PjDriver__.run(a); } } ';

const JAVA_DRIVER = String.raw`
class PjExit__ extends SecurityException {
    final int status;
    PjExit__(int s) { super("exit " + s); status = s; }
}

class PjDriver__ {
    static String ENTRY = "%ENTRY%";

    static void run(String[] args) throws Exception {
        if (args.length < 4 || !args[0].equals("--pj")) {
            Class.forName(ENTRY).getMethod("main", String[].class).invoke(null, (Object) args);
            return;
        }
        final long tl = Long.parseLong(args[1]);
        final long budget = Long.parseLong(args[3]);
        byte[] all = System.in.readAllBytes();
        java.io.PrintStream realOut = new java.io.PrintStream(new java.io.FileOutputStream(java.io.FileDescriptor.out), false);
        System.setErr(new java.io.PrintStream(java.io.OutputStream.nullOutputStream()));
        System.setSecurityManager(new SecurityManager() {
            @Override public void checkPermission(java.security.Permission p) {}
            @Override public void checkPermission(java.security.Permission p, Object c) {}
            @Override public void checkExit(int status) { throw new PjExit__(status); }
        });
        final ClassLoader parent = PjDriver__.class.getClassLoader();
        final java.lang.management.ThreadMXBean mx = java.lang.management.ManagementFactory.getThreadMXBean();

        int pos = 0;
        int nl = indexOf(all, (byte) '\n', pos);
        int count = Integer.parseInt(new String(all, pos, nl - pos).trim());
        pos = nl + 1;
        long startAll = System.nanoTime();
        String reason = "done";

        for (int idx = 1; idx <= count; idx++) {
            if ((System.nanoTime() - startAll) / 1_000_000 > budget) { reason = "budget"; break; }
            nl = indexOf(all, (byte) '\n', pos);
            int n = Integer.parseInt(new String(all, pos, nl - pos).trim());
            byte[] input = java.util.Arrays.copyOfRange(all, nl + 1, nl + 1 + n);
            pos = nl + 1 + n;

            final java.io.ByteArrayOutputStream captured = new java.io.ByteArrayOutputStream();
            System.setIn(new java.io.ByteArrayInputStream(input));
            System.setOut(new java.io.PrintStream(captured, false));
            final ClassLoader fresh = new ClassLoader(parent) {
                @Override protected Class<?> loadClass(String name, boolean resolve) throws ClassNotFoundException {
                    synchronized (getClassLoadingLock(name)) {
                        Class<?> c = findLoadedClass(name);
                        if (c == null) {
                            if (name.startsWith("java.") || name.startsWith("javax.") || name.startsWith("jdk.")
                                    || name.startsWith("sun.") || name.startsWith("com.sun.") || name.startsWith("PjDriver__")
                                    || name.startsWith("PjExit__")) {
                                return super.loadClass(name, resolve);
                            }
                            try (java.io.InputStream in = parent.getResourceAsStream(name.replace('.', '/') + ".class")) {
                                if (in == null) return super.loadClass(name, resolve);
                                byte[] b = in.readAllBytes();
                                c = defineClass(name, b, 0, b.length);
                            } catch (java.io.IOException e) {
                                throw new ClassNotFoundException(name, e);
                            }
                        }
                        if (resolve) resolveClass(c);
                        return c;
                    }
                }
            };
            final Throwable[] error = new Throwable[1];
            final int[] code = {0};
            final long[] cpuNs = {0};
            Thread th = new Thread(null, () -> {
                try {
                    Class.forName(ENTRY, true, fresh).getMethod("main", String[].class).invoke(null, (Object) new String[0]);
                } catch (java.lang.reflect.InvocationTargetException e) {
                    Throwable c = e.getCause();
                    if (c instanceof PjExit__) code[0] = ((PjExit__) c).status; else error[0] = c;
                } catch (Throwable t) {
                    if (t instanceof PjExit__) code[0] = ((PjExit__) t).status; else error[0] = t;
                } finally {
                    System.out.flush();
                    cpuNs[0] = mx.getCurrentThreadCpuTime();
                }
            }, "main", 1L << 28);
            long t0 = System.nanoTime();
            th.start();
            th.join(tl * 2 + 500);
            boolean timedOut = th.isAlive();
            long wall = (System.nanoTime() - t0) / 1_000_000;
            long cpu = timedOut ? wall : cpuNs[0] / 1_000_000;

            String status = "OK";
            int exit = code[0];
            if (timedOut || cpu > tl) status = "TLE";
            else if (error[0] instanceof OutOfMemoryError) { status = "MLE"; exit = 1; }
            else if (error[0] != null) { status = "RE"; exit = 1; }
            else if (exit != 0) status = "RE";

            byte[] result = captured.toByteArray();
            realOut.print("@@T " + idx + " " + status + " " + exit + " " + cpu + " " + wall + " 0 " + result.length + "\n");
            realOut.write(result, 0, result.length);
            realOut.print("\n");
            realOut.flush();
            if (!status.equals("OK")) { reason = "failed"; break; }
        }
        realOut.print("@@END " + reason + "\n");
        realOut.flush();
        Runtime.getRuntime().halt(0);
    }

    static int indexOf(byte[] a, byte b, int from) {
        for (int i = from; i < a.length; i++) if (a[i] == b) return i;
        return a.length;
    }
}
`;

const TYPE_RE = /^([ \t]*)((?:(?:public|final|abstract|strictfp)\s+)*(?:class|interface|enum|record)\s+([A-Za-z_$][\w$]*))/m;

// Insert the launcher in front of the first top-level type (same line) and
// append the driver. Returns null when no class can be found.
export function wrapJava(source) {
  const match = TYPE_RE.exec(source);
  if (!match) return null;
  const at = match.index + match[1].length;
  const entry = match[3];
  return source.slice(0, at) + JAVA_LAUNCHER + source.slice(at) + '\n' +
    JAVA_DRIVER.replace('%ENTRY%', entry);
}
