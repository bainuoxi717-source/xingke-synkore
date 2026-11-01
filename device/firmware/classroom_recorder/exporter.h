#ifndef CLASSROOM_RECORDER_EXPORTER_H
#define CLASSROOM_RECORDER_EXPORTER_H

#include "File.h"
#include "uart_protocol.h"

bool exportCoursePackage(VFSFILE& fs, Scf1Protocol& protocol, const char* courseId);

#endif
