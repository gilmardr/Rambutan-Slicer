# CMake toolchain for C/C++ dependencies of the 32-bit Windows build.
#
# manifold-csg-sys runs `cmake` directly (not through the cmake crate), so it
# gets no target architecture or C runtime from cargo: on a 64-bit runner the
# Visual Studio generator builds x64 objects with /MD, which an i686 binary
# linked with +crt-static (.cargo/config.toml) cannot use. The release workflow
# points CMAKE_TOOLCHAIN_FILE here for the x86 job only.
set(CMAKE_GENERATOR_PLATFORM Win32 CACHE STRING "" FORCE)
set(CMAKE_POLICY_DEFAULT_CMP0091 NEW)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded" CACHE STRING "" FORCE)
