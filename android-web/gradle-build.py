"""Builds the Capacitor Android project the same way C:\\ad\\android\\android.py builds its apps (detached process,
shared Gradle cache), because a plain gradlew run fails here with "Unable to establish loopback connection".
Usage: python android-web/gradle-build.py assembleDebug"""
import os
import subprocess
import sys
import time

JDK = r"C:\ad\jdk21"
SDK = r"C:\ad\sdk"
proj = os.environ.get("PM_ANDROID_DIR") or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "android")
task = sys.argv[1] if len(sys.argv) > 1 else "assembleDebug"
env = dict(os.environ)
env.update(JAVA_HOME=JDK, ANDROID_HOME=SDK, ANDROID_SDK_ROOT=SDK, GRADLE_USER_HOME=r"C:\ad\gradle")
env["PATH"] = os.pathsep.join([os.path.join(JDK, "bin"), env.get("PATH", "")])
log = os.path.join(proj, "build-" + task + ".log")
args = [os.path.join(JDK, "bin", "java.exe"), "-Dorg.gradle.appname=gradlew", "-classpath",
        os.path.join("gradle", "wrapper", "gradle-wrapper.jar"), "org.gradle.wrapper.GradleWrapperMain",
        task, "--console=plain", "--stacktrace"]
with open(log, "w") as f:
    p = subprocess.Popen(args, cwd=proj, env=env, stdout=f, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                         creationflags=0x00000008 | 0x00000200)
    t = time.time()
    while p.poll() is None:
        if time.time() - t > 1500:
            p.kill()
            sys.exit("timed out, see " + log)
        time.sleep(2)
out = open(log, errors="replace").read()
print(out[-1500:])
print("BUILD OK" if "BUILD SUCCESSFUL" in out else "BUILD FAILED, see " + log)
